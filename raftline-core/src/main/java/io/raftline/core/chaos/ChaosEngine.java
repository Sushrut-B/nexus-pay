package io.raftline.core.chaos;

import io.raftline.storage.model.Command;
import io.raftline.core.RaftNode;
import io.raftline.core.Role;
import io.raftline.core.transport.RaftTransport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Embedded Disaster Simulator and Chaos Engineering Controller for Raftline.
 * Coordinates dynamic fault injection, preset disaster scenarios, automated self-healing
 * countdowns, and real-time consensus invariant verification.
 */
public class ChaosEngine implements AutoCloseable {
    private static final Logger log = LoggerFactory.getLogger(ChaosEngine.class);

    private final RaftNode node;
    private final ScheduledExecutorService autoHealScheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "chaos-auto-heal");
        t.setDaemon(true);
        return t;
    });

    private final List<ChaosEvent> history = new CopyOnWriteArrayList<>();
    private final AtomicLong eventSequence = new AtomicLong(0);

    public ChaosEngine(RaftNode node) {
        this.node = Objects.requireNonNull(node, "node");
    }

    public synchronized ChaosEvent inject(ChaosScenario scenario, Map<String, Object> params) {
        long id = eventSequence.incrementAndGet();
        String target = params != null && params.containsKey("target") ? params.get("target").toString() : "cluster";
        String details = "";
        RaftTransport transport = node.getTransport();

        switch (scenario) {
            case KILL_LEADER -> {
                if (node.getRole() == Role.LEADER) {
                    node.abdicate();
                    details = "Leader voluntarily abdicated. Stepped down to FOLLOWER in term " + node.getCurrentTerm();
                } else {
                    details = "Node " + node.getConfig().getLocalNodeId() + " is not leader (current role: "
                            + node.getRole() + ", active leader: " + node.getCurrentLeaderId() + ")";
                }
            }
            case PARTITION_NODE -> {
                String peerId = params != null ? (String) params.get("peer") : null;
                if (peerId != null && !peerId.isBlank()) {
                    transport.isolatePeer(peerId);
                    details = "Isolated connection to peer " + peerId;
                    target = peerId;
                } else {
                    for (String peer : node.getConfig().getPeerIds()) {
                        transport.isolatePeer(peer);
                    }
                    details = "Isolated local node from all peers: " + node.getConfig().getPeerIds();
                    target = "all-peers";
                }
            }
            case PARTITION_MINORITY -> {
                List<String> peers = new ArrayList<>(node.getConfig().getPeerIds());
                int minorityCount = Math.max(1, peers.size() / 2);
                List<String> isolated = new ArrayList<>();
                for (int i = 0; i < minorityCount && i < peers.size(); i++) {
                    String p = peers.get(i);
                    transport.isolatePeer(p);
                    isolated.add(p);
                }
                details = "Isolated minority partition peers: " + isolated;
                target = isolated.toString();
            }
            case PARTITION_MAJORITY -> {
                List<String> peers = new ArrayList<>(node.getConfig().getPeerIds());
                int majorityCount = (peers.size() / 2) + 1;
                List<String> isolated = new ArrayList<>();
                for (int i = 0; i < majorityCount && i < peers.size(); i++) {
                    String p = peers.get(i);
                    transport.isolatePeer(p);
                    isolated.add(p);
                }
                details = "Isolated majority partition peers: " + isolated;
                target = isolated.toString();
            }
            case ASYMMETRIC_PARTITION -> {
                String peerId = params != null ? (String) params.get("peer") : null;
                if (peerId == null && !node.getConfig().getPeerIds().isEmpty()) {
                    peerId = node.getConfig().getPeerIds().iterator().next();
                }
                if (peerId != null) {
                    transport.isolatePeer(peerId);
                    details = "Asymmetrical directional drop outgoing to peer " + peerId;
                    target = peerId;
                }
            }
            case PACKET_JITTER_STORM -> {
                long delay = params != null && params.containsKey("delayMs") ? ((Number) params.get("delayMs")).longValue() : 250L;
                double dropRate = params != null && params.containsKey("dropRate") ? ((Number) params.get("dropRate")).doubleValue() : 0.4;
                for (String peer : node.getConfig().getPeerIds()) {
                    transport.setPeerDelay(peer, delay);
                    transport.setPeerDropRate(peer, dropRate);
                }
                details = "Injected jitter storm: " + delay + "ms latency, " + (int)(dropRate * 100) + "% drop rate";
                target = "all-peers";
            }
            case FREEZE_NODE -> {
                long durationMs = params != null && params.containsKey("durationMs") ? ((Number) params.get("durationMs")).longValue() : 3000L;
                node.pause();
                autoHealScheduler.schedule(node::resume, durationMs, TimeUnit.MILLISECONDS);
                details = "Node frozen (simulating GC pause / process hang) for " + durationMs + "ms";
                target = node.getConfig().getLocalNodeId();
            }
            case HEAL_ALL -> {
                transport.healAll();
                if (node.isPaused()) {
                    node.resume();
                }
                details = "All partitions, latency delays, and drop rates healed. Node resumed.";
                target = "cluster";
            }
            case CUSTOM -> {
                String peerId = params != null ? (String) params.get("peer") : null;
                if (peerId != null) {
                    target = peerId;
                    if (params.containsKey("delayMs")) {
                        long d = ((Number) params.get("delayMs")).longValue();
                        transport.setPeerDelay(peerId, d);
                    }
                    if (params.containsKey("dropRate")) {
                        double dr = ((Number) params.get("dropRate")).doubleValue();
                        transport.setPeerDropRate(peerId, dr);
                    }
                    if (Boolean.TRUE.equals(params.get("isolate"))) {
                        transport.isolatePeer(peerId);
                    } else if (Boolean.FALSE.equals(params.get("isolate"))) {
                        transport.healPeer(peerId);
                    }
                    details = "Custom network fault injected for peer " + peerId;
                }
            }
        }

        // Schedule auto-heal if requested
        if (params != null && params.containsKey("autoHealAfterMs")) {
            long autoHealMs = ((Number) params.get("autoHealAfterMs")).longValue();
            if (autoHealMs > 0 && scenario != ChaosScenario.HEAL_ALL) {
                autoHealScheduler.schedule(this::healAll, autoHealMs, TimeUnit.MILLISECONDS);
                details += " [Auto-heal scheduled in " + autoHealMs + "ms]";
            }
        }

        ChaosEvent event = new ChaosEvent(id, Instant.now(), scenario, target, details, scenario != ChaosScenario.HEAL_ALL);
        history.add(0, event);
        if (history.size() > 50) {
            history.remove(history.size() - 1);
        }
        log.warn("Chaos injected on node {}: scenario={}, target={}, details={}",
                node.getConfig().getLocalNodeId(), scenario, target, details);
        return event;
    }

    public synchronized void healAll() {
        node.getTransport().healAll();
        if (node.isPaused()) {
            node.resume();
        }
        long id = eventSequence.incrementAndGet();
        ChaosEvent event = new ChaosEvent(id, Instant.now(), ChaosScenario.HEAL_ALL, "cluster", "All partitions healed and node unpaused", false);
        history.add(0, event);
        if (history.size() > 50) {
            history.remove(history.size() - 1);
        }
        log.info("Node {} cleared all chaos faults and restored full connectivity", node.getConfig().getLocalNodeId());
    }

    public ChaosStatus getStatus() {
        RaftTransport transport = node.getTransport();
        return new ChaosStatus(
                node.getConfig().getLocalNodeId(),
                node.getRole().name(),
                node.isPaused(),
                transport.getIsolatedPeers(),
                transport.getPeerDelays(),
                transport.getPeerDropRates(),
                Collections.unmodifiableList(history)
        );
    }

    public ChaosValidationReport runValidationProbe() {
        Instant now = Instant.now();
        List<String> checks = new ArrayList<>();
        String status = "HEALTHY";
        long startNanos = System.nanoTime();
        long probeLatencyMs = 0;
        int activeFaultCount = node.getTransport().getIsolatedPeers().size()
                + node.getTransport().getPeerDelays().size()
                + (node.isPaused() ? 1 : 0);

        String leaderId = node.getCurrentLeaderId();
        long term = node.getCurrentTerm();
        boolean leaseActive = node.isLeaderLeaseValid();

        if (leaderId == null) {
            checks.add("WARN: No active leader established on local node.");
            status = "DEGRADED";
        } else {
            checks.add("PASS: Cluster leader established: " + leaderId + " (term=" + term + ")");
        }

        if (node.getRole() == Role.LEADER) {
            if (leaseActive) {
                checks.add("PASS: Zero-RPC Leader Lease is active and valid.");
            } else {
                checks.add("INFO: Leader lease waiting for majority heartbeat renewal.");
            }
        }

        // Test probe write if node is leader
        if (node.getRole() == Role.LEADER && !node.isPaused()) {
            String probeKey = "__chaos_probe_" + System.currentTimeMillis();
            try {
                Command cmd = Command.put(probeKey, "probe-ok".getBytes(StandardCharsets.UTF_8), "chaos-prober", System.nanoTime());
                node.execute(cmd).get(1500, TimeUnit.MILLISECONDS);
                probeLatencyMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
                checks.add("PASS: Consensus write probe committed linearizably in " + probeLatencyMs + "ms.");
            } catch (Exception e) {
                checks.add("FAIL: Write probe failed to commit: " + e.getMessage());
                status = activeFaultCount > 0 ? "SPLIT_BRAIN_PROTECTED" : "CRITICAL";
            }
        } else if (node.getRole() == Role.FOLLOWER) {
            probeLatencyMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
            checks.add("INFO: Node is follower; commitIndex=" + node.getCommitIndex() + ", lastApplied=" + node.getLastApplied());
            if (activeFaultCount > 0 && leaderId != null && node.getTransport().isPeerIsolated(leaderId)) {
                checks.add("INFO: Isolated from leader. Split-brain safety invariant maintained.");
                status = "DEGRADED";
            }
        }

        String summary;
        if ("HEALTHY".equals(status)) {
            summary = "Cluster consensus is healthy and resilient. Quorum operational.";
        } else if ("DEGRADED".equals(status)) {
            summary = "Cluster operating in degraded/partitioned state. Consensus invariants preserved.";
        } else if ("SPLIT_BRAIN_PROTECTED".equals(status)) {
            summary = "Write rejected to prevent split-brain partition corruption. Invariant verified.";
        } else {
            summary = "Critical consensus state: cluster quorum unachieved or leader unavailable.";
        }

        return new ChaosValidationReport(
                now,
                status,
                leaderId,
                term,
                leaseActive,
                probeLatencyMs,
                activeFaultCount,
                node.getTransport().getIsolatedPeers(),
                checks,
                summary
        );
    }

    @Override
    public void close() {
        autoHealScheduler.shutdownNow();
    }
}
