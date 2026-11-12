package io.raftline.core.dbaas;

/**
 * Represents a registered database tenant with resource quotas and SLA tier.
 */
public record Tenant(
        String tenantId,
        String name,
        String tier,              // STARTER, PRO, ENTERPRISE
        int maxOpsPerSec,
        long maxKeys,
        long maxStorageBytes,
        long createdAtEpochMs,
        String status             // ACTIVE, SUSPENDED
) {
    public static Tenant create(String tenantId, String name, String tier) {
        String t = (tier != null && !tier.isBlank()) ? tier.toUpperCase() : "STARTER";
        int rps = switch (t) {
            case "ENTERPRISE" -> 10000;
            case "PRO" -> 1000;
            default -> 100;
        };
        long keys = switch (t) {
            case "ENTERPRISE" -> 1_000_000L;
            case "PRO" -> 100_000L;
            default -> 10_000L;
        };
        long bytes = switch (t) {
            case "ENTERPRISE" -> 10L * 1024 * 1024 * 1024;
            case "PRO" -> 1L * 1024 * 1024 * 1024;
            default -> 100L * 1024 * 1024;
        };
        return new Tenant(tenantId, name != null ? name : tenantId, t, rps, keys, bytes, System.currentTimeMillis(), "ACTIVE");
    }

    public static Tenant defaultTenant() {
        return new Tenant(
                "default",
                "Default Workspace",
                "ENTERPRISE",
                10000,
                1000000L,
                10L * 1024 * 1024 * 1024, // 10 GB
                System.currentTimeMillis(),
                "ACTIVE"
        );
    }

    public java.util.Map<String, Object> toMap() {
        return java.util.Map.of(
                "tenantId", tenantId,
                "name", name != null ? name : tenantId,
                "tier", tier != null ? tier : "STARTER",
                "maxOpsPerSec", maxOpsPerSec,
                "maxKeys", maxKeys,
                "maxStorageBytes", maxStorageBytes,
                "createdAtEpochMs", createdAtEpochMs,
                "status", status != null ? status : "ACTIVE"
        );
    }
}
