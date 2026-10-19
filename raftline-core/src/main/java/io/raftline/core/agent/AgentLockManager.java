package io.raftline.core.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.raftline.core.RaftNode;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Distributed Multi-Agent Lock Manager with Monotonic Fencing Tokens.
 *
 * Implements Martin Kleppmann's consensus fencing token specification:
 * Whenever an AI agent acquires a lock on a shared resource (e.g. "tool:flight_booking",
 * "agent:shared_plan"), the cluster generates a monotonically increasing token.
 * Downstream execution services (databases, LLM tool executors) inspect this token
 * and reject any stale requests from a previous or paused agent, completely preventing
 * split-brain AI agent tool actions.
 */
public class AgentLockManager {
    private static final Logger log = LoggerFactory.getLogger(AgentLockManager.class);
    private static final ObjectMapper json = new ObjectMapper();

    public static final String LOCK_PREFIX = "__sys:agent:lock:";
    public static final String FENCE_SEQ_KEY = "__sys:agent:fence_seq";

    private final RaftNode raftNode;

    public AgentLockManager(RaftNode raftNode) {
        this.raftNode = Objects.requireNonNull(raftNode, "raftNode");
    }

    /**
     * Attempts to acquire a distributed lock on a resource for a specified agent.
     *
     * @param resource Resource name (e.g. "tool:execute_trade")
     * @param agentId Unique identifier of the requesting AI agent
     * @param ttlMs Time-to-live for the lease in milliseconds
     * @return CompletableFuture containing the acquired lock info, or empty if already locked by another active agent
     */
    public synchronized CompletableFuture<Optional<AgentLockInfo>> acquireLock(String resource, String agentId, long ttlMs) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String lockKey = LOCK_PREFIX + resource;
                byte[] existingBytes = raftNode.readLinearizable(lockKey).get(5, TimeUnit.SECONDS);

                long now = System.currentTimeMillis();
                if (existingBytes != null && existingBytes.length > 0) {
                    AgentLockInfo existing = json.readValue(existingBytes, AgentLockInfo.class);
                    // Check if current lock is held by another agent and not expired
                    if (!existing.isExpired() && !existing.getOwnerAgentId().equals(agentId)) {
                        log.debug("Resource '{}' is currently locked by agent '{}'", resource, existing.getOwnerAgentId());
                        return Optional.empty();
                    }
                }

                // Increment global monotonic fencing token counter
                long nextFencingToken = incrementFencingToken();

                AgentLockInfo newLock = new AgentLockInfo(
                        resource,
                        agentId,
                        nextFencingToken,
                        now,
                        now + Math.max(1000, ttlMs)
                );

                byte[] lockBytes = json.writeValueAsBytes(newLock);
                Command cmd = Command.put(lockKey, lockBytes, "agent:" + agentId, nextFencingToken);
                ApplyResult result = raftNode.execute(cmd).get(5, TimeUnit.SECONDS);

                if (result.isSuccess()) {
                    log.info("Agent '{}' acquired lock on '{}' with fencingToken={}", agentId, resource, nextFencingToken);
                    return Optional.of(newLock);
                }
                return Optional.empty();
            } catch (Exception e) {
                log.error("Failed to acquire agent lock on '{}' for agent '{}'", resource, agentId, e);
                throw new RuntimeException("Error acquiring agent lock: " + e.getMessage(), e);
            }
        });
    }

    /**
     * Renews an existing lock lease for an agent holding the lock.
     */
    public synchronized CompletableFuture<Optional<AgentLockInfo>> renewLock(String resource, String agentId, long fencingToken, long extendTtlMs) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String lockKey = LOCK_PREFIX + resource;
                byte[] existingBytes = raftNode.readLinearizable(lockKey).get(5, TimeUnit.SECONDS);

                if (existingBytes == null || existingBytes.length == 0) {
                    return Optional.empty(); // Lock doesn't exist
                }

                AgentLockInfo existing = json.readValue(existingBytes, AgentLockInfo.class);
                if (!existing.getOwnerAgentId().equals(agentId) || existing.getFencingToken() != fencingToken) {
                    log.warn("Unauthorized renew attempt for resource '{}' by agent '{}' (fencingToken={})", resource, agentId, fencingToken);
                    return Optional.empty();
                }

                long now = System.currentTimeMillis();
                AgentLockInfo renewed = new AgentLockInfo(
                        resource,
                        agentId,
                        fencingToken,
                        existing.getAcquiredAtEpochMs(),
                        now + Math.max(1000, extendTtlMs)
                );

                byte[] lockBytes = json.writeValueAsBytes(renewed);
                Command cmd = Command.put(lockKey, lockBytes, "agent:" + agentId, System.nanoTime());
                ApplyResult result = raftNode.execute(cmd).get(5, TimeUnit.SECONDS);

                if (result.isSuccess()) {
                    log.info("Agent '{}' renewed lock on '{}' (fencingToken={})", agentId, resource, fencingToken);
                    return Optional.of(renewed);
                }
                return Optional.empty();
            } catch (Exception e) {
                log.error("Failed to renew agent lock on '{}'", resource, e);
                throw new RuntimeException("Error renewing agent lock: " + e.getMessage(), e);
            }
        });
    }

    /**
     * Releases an active agent lock.
     */
    public synchronized CompletableFuture<Boolean> releaseLock(String resource, String agentId, long fencingToken) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String lockKey = LOCK_PREFIX + resource;
                byte[] existingBytes = raftNode.readLinearizable(lockKey).get(5, TimeUnit.SECONDS);

                if (existingBytes == null || existingBytes.length == 0) {
                    return true; // Already released or expired
                }

                AgentLockInfo existing = json.readValue(existingBytes, AgentLockInfo.class);
                if (!existing.getOwnerAgentId().equals(agentId) || existing.getFencingToken() != fencingToken) {
                    log.warn("Agent '{}' cannot release lock for '{}': token mismatch (expected {}, got {})",
                            agentId, resource, existing.getFencingToken(), fencingToken);
                    return false;
                }

                Command cmd = Command.delete(lockKey, "agent:" + agentId, System.nanoTime());
                ApplyResult result = raftNode.execute(cmd).get(5, TimeUnit.SECONDS);

                if (result.isSuccess()) {
                    log.info("Agent '{}' released lock on '{}' (fencingToken={})", agentId, resource, fencingToken);
                    return true;
                }
                return false;
            } catch (Exception e) {
                log.error("Failed to release agent lock on '{}'", resource, e);
                throw new RuntimeException("Error releasing agent lock: " + e.getMessage(), e);
            }
        });
    }

    /**
     * Inspects the current lock state on a resource without modifying it.
     */
    public CompletableFuture<Optional<AgentLockInfo>> getLockStatus(String resource) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String lockKey = LOCK_PREFIX + resource;
                byte[] bytes = raftNode.readLinearizable(lockKey).get(5, TimeUnit.SECONDS);
                if (bytes == null || bytes.length == 0) {
                    return Optional.empty();
                }
                AgentLockInfo info = json.readValue(bytes, AgentLockInfo.class);
                return Optional.of(info);
            } catch (Exception e) {
                log.error("Failed to get agent lock status on '{}'", resource, e);
                throw new RuntimeException("Error inspecting lock: " + e.getMessage(), e);
            }
        });
    }

    private synchronized long incrementFencingToken() throws Exception {
        byte[] seqBytes = raftNode.readLinearizable(FENCE_SEQ_KEY).get(5, TimeUnit.SECONDS);
        long currentSeq = 1000L;
        if (seqBytes != null && seqBytes.length > 0) {
            try {
                currentSeq = Long.parseLong(new String(seqBytes, StandardCharsets.UTF_8).trim());
            } catch (NumberFormatException ignored) {}
        }
        long nextSeq = currentSeq + 1;
        Command cmd = Command.put(FENCE_SEQ_KEY, String.valueOf(nextSeq).getBytes(StandardCharsets.UTF_8), "system", System.nanoTime());
        ApplyResult res = raftNode.execute(cmd).get(5, TimeUnit.SECONDS);
        if (!res.isSuccess()) {
            throw new RuntimeException("Failed to advance fencing token sequence");
        }
        return nextSeq;
    }
}
