package io.raftline.core.dbaas;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thread-safe multi-tenant DBaaS manager. Handles tenant provisioning,
 * keyspace partitioning, token-bucket rate limiting, and quota enforcement.
 */
public class TenantManager {
    private static final Logger log = LoggerFactory.getLogger(TenantManager.class);

    private final Map<String, Tenant> tenants = new ConcurrentHashMap<>();
    private final Map<String, TenantRateLimiter> rateLimiters = new ConcurrentHashMap<>();
    private final Map<String, TenantUsage> usages = new ConcurrentHashMap<>();

    public TenantManager() {
        // Register standard default tenant
        registerTenant(Tenant.defaultTenant());
    }

    public synchronized Tenant registerTenant(Tenant tenant) {
        Objects.requireNonNull(tenant, "tenant");
        tenants.put(tenant.tenantId(), tenant);
        rateLimiters.put(tenant.tenantId(), new TenantRateLimiter(tenant.maxOpsPerSec()));
        usages.computeIfAbsent(tenant.tenantId(), id -> new TenantUsage());
        log.info("Registered tenant '{}' [{}] with limit {} ops/sec",
                tenant.tenantId(), tenant.tier(), tenant.maxOpsPerSec());
        return tenant;
    }

    public Optional<Tenant> getTenant(String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            return Optional.ofNullable(tenants.get("default"));
        }
        return Optional.ofNullable(tenants.get(tenantId));
    }

    public String toTenantKey(String tenantId, String key) {
        if (tenantId == null || tenantId.isBlank() || "default".equalsIgnoreCase(tenantId)) {
            return key;
        }
        return "tenant:" + tenantId + ":" + key;
    }

    public String fromTenantKey(String tenantId, String isolatedKey) {
        if (tenantId == null || tenantId.isBlank() || "default".equalsIgnoreCase(tenantId)) {
            return isolatedKey;
        }
        String prefix = "tenant:" + tenantId + ":";
        if (isolatedKey != null && isolatedKey.startsWith(prefix)) {
            return isolatedKey.substring(prefix.length());
        }
        return isolatedKey;
    }

    public List<Tenant> getAllTenants() {
        return new ArrayList<>(tenants.values());
    }

    public synchronized boolean deleteTenant(String tenantId) {
        if ("default".equals(tenantId)) {
            return false; // cannot delete default tenant
        }
        boolean removed = tenants.remove(tenantId) != null;
        rateLimiters.remove(tenantId);
        usages.remove(tenantId);
        log.info("Deleted tenant '{}'", tenantId);
        return removed;
    }

    public boolean tryAcquire(String tenantId) {
        String id = (tenantId == null || tenantId.isBlank()) ? "default" : tenantId;
        Tenant tenant = tenants.get(id);
        if (tenant == null) {
            return false;
        }
        if ("SUSPENDED".equalsIgnoreCase(tenant.status())) {
            return false;
        }
        TenantRateLimiter limiter = rateLimiters.get(id);
        if (limiter != null && !limiter.tryAcquire()) {
            TenantUsage usage = usages.get(id);
            if (usage != null) usage.recordRateLimitViolation();
            return false;
        }
        return true;
    }

    public void recordOp(String tenantId, int bytes) {
        String id = (tenantId == null || tenantId.isBlank()) ? "default" : tenantId;
        TenantUsage usage = usages.get(id);
        if (usage != null) {
            usage.recordOp(bytes);
        }
    }

    public TenantUsage getUsage(String tenantId) {
        String id = (tenantId == null || tenantId.isBlank()) ? "default" : tenantId;
        return usages.computeIfAbsent(id, k -> new TenantUsage());
    }

    public Map<String, Object> getTenantSummary(String tenantId) {
        Tenant tenant = tenants.get(tenantId);
        if (tenant == null) return Map.of();
        TenantUsage usage = getUsage(tenantId);
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("tenantId", tenant.tenantId());
        map.put("name", tenant.name());
        map.put("tier", tenant.tier());
        map.put("status", tenant.status());
        map.put("maxOpsPerSec", tenant.maxOpsPerSec());
        map.put("maxKeys", tenant.maxKeys());
        map.put("maxStorageBytes", tenant.maxStorageBytes());
        map.put("currentOpsPerSec", usage.getCurrentOpsPerSec());
        map.put("totalOps", usage.getTotalOps());
        map.put("totalBytes", usage.getTotalBytes());
        map.put("rateLimitViolations", usage.getRateLimitViolations());
        map.put("quotaViolations", usage.getQuotaViolations());
        return Collections.unmodifiableMap(map);
    }
}
