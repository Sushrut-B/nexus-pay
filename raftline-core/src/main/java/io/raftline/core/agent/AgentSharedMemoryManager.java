package io.raftline.core.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.raftline.core.RaftNode;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import io.raftline.storage.state.VersionedValue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Distributed Multi-Agent Shared Memory Primitive.
 *
 * Provides linearizable state management, atomic Compare-And-Swap (CAS),
 * agent barrier synchronization, and atomic turn handoffs across AI agent workflows.
 */
public class AgentSharedMemoryManager {
    private static final Logger log = LoggerFactory.getLogger(AgentSharedMemoryManager.class);
    private static final ObjectMapper json = new ObjectMapper();

    public static final String BARRIER_PREFIX = "__sys:agent:barrier:";
    public static final String TURNHANDOFF_PREFIX = "__sys:agent:turn:";

    private final RaftNode raftNode;

    public AgentSharedMemoryManager(RaftNode raftNode) {
        this.raftNode = Objects.requireNonNull(raftNode, "raftNode");
    }

    /**
     * Executes an atomic Compare-And-Swap on a key.
     *
     * @param key Key to update
     * @param expectedVersion Expected current version of the key (0 if expecting key not to exist)
     * @param newValue New value bytes
     * @param agentId Unique ID of the agent performing the CAS
     * @return CompletableFuture with ApplyResult containing the committed or conflict version
     */
    public CompletableFuture<ApplyResult> compareAndSwap(String key, long expectedVersion, byte[] newValue, String agentId) {
        long seqNum = System.nanoTime();
        return raftNode.compareAndSwap(key, expectedVersion, newValue, "agent:" + agentId, seqNum);
    }

    /**
     * Reads state with its linearizable monotonic version.
     */
    public CompletableFuture<VersionedValue> getAgentState(String key) {
        return raftNode.readLinearizableVersioned(key);
    }

    /**
     * Multi-agent barrier synchronization.
     * Multiple agents register their arrival at a named barrier. When the barrier reaches targetCount,
     * all participating agents are released.
     */
    public CompletableFuture<Boolean> registerBarrier(String barrierName, String agentId, int targetCount) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String barrierKey = BARRIER_PREFIX + barrierName;
                for (int attempt = 0; attempt < 10; attempt++) {
                    VersionedValue cur = raftNode.readLinearizableVersioned(barrierKey).get(5, TimeUnit.SECONDS);
                    Set<String> arrived = new HashSet<>();
                    if (cur != null && cur.value() != null && cur.value().length > 0) {
                        try {
                            List<String> list = json.readValue(cur.value(), List.class);
                            arrived.addAll(list);
                        } catch (Exception ignored) {}
                    }

                    arrived.add(agentId);
                    byte[] newPayload = json.writeValueAsBytes(new ArrayList<>(arrived));
                    long expectedVersion = cur != null ? cur.version() : 0L;

                    ApplyResult res = raftNode.compareAndSwap(barrierKey, expectedVersion, newPayload, "barrier:" + agentId, System.nanoTime())
                            .get(5, TimeUnit.SECONDS);

                    if (res.isSuccess()) {
                        log.info("Agent '{}' checked in to barrier '{}' ({}/{})", agentId, barrierName, arrived.size(), targetCount);
                        return arrived.size() >= targetCount;
                    }
                    // Version conflict, retry
                    Thread.sleep(50);
                }
                return false;
            } catch (Exception e) {
                log.error("Failed to register barrier '{}' for agent '{}'", barrierName, agentId, e);
                throw new RuntimeException(e);
            }
        });
    }

    /**
     * Checks if a barrier has achieved quorum or target count.
     */
    public CompletableFuture<Boolean> isBarrierPassed(String barrierName, int targetCount) {
        return raftNode.readLinearizableVersioned(BARRIER_PREFIX + barrierName)
                .thenApply(val -> {
                    if (val == null || val.value() == null || val.value().length == 0) {
                        return false;
                    }
                    try {
                        List<String> arrived = json.readValue(val.value(), List.class);
                        return arrived.size() >= targetCount;
                    } catch (Exception e) {
                        return false;
                    }
                });
    }

    /**
     * Atomic Turn Handoff for sequential agent pipelines (e.g. Planner -> Coder -> Reviewer).
     * Only the designated currentAgent can hand off turn to nextAgent with an attached state payload.
     */
    public CompletableFuture<Boolean> handoffTurn(String workflowId, String currentAgent, String nextAgent, String payload) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String turnKey = TURNHANDOFF_PREFIX + workflowId;
                VersionedValue cur = raftNode.readLinearizableVersioned(turnKey).get(5, TimeUnit.SECONDS);

                if (cur != null && cur.value() != null && cur.value().length > 0) {
                    Map<String, String> state = json.readValue(cur.value(), Map.class);
                    String activeHolder = state.get("currentAgent");
                    if (activeHolder != null && !activeHolder.equals(currentAgent)) {
                        log.warn("Turn handoff rejected: workflow '{}' held by '{}', but '{}' tried to handoff",
                                workflowId, activeHolder, currentAgent);
                        return false;
                    }
                }

                Map<String, Object> nextState = Map.of(
                        "workflowId", workflowId,
                        "currentAgent", nextAgent,
                        "previousAgent", currentAgent,
                        "payload", payload != null ? payload : "",
                        "timestampEpochMs", System.currentTimeMillis()
                );
                byte[] bytes = json.writeValueAsBytes(nextState);
                long expectedVersion = cur != null ? cur.version() : 0L;

                ApplyResult res = raftNode.compareAndSwap(turnKey, expectedVersion, bytes, "workflow:" + currentAgent, System.nanoTime())
                        .get(5, TimeUnit.SECONDS);

                return res.isSuccess();
            } catch (Exception e) {
                log.error("Error performing turn handoff on workflow '{}'", workflowId, e);
                throw new RuntimeException(e);
            }
        });
    }
}
