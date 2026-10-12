package io.raftline.testkit;

import io.raftline.core.RaftNode;
import io.raftline.core.Role;
import io.raftline.core.config.RaftConfig;
import io.raftline.core.transport.RaftRpcHandler;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import io.raftline.storage.state.KeyValueStore;
import io.raftline.storage.wal.WriteAheadLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;

/**
 * High-level Raft Cluster Simulator for deterministic failure and consensus testing.
 * Manages N independent nodes, file persistence, partitions, and recovery.
 */
public class ClusterSimulator implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(ClusterSimulator.class);

    private final File baseDir;
    private final int clusterSize;
    private final List<String> nodeIds = new ArrayList<>();
    private final Map<String, RaftNode> nodes = new ConcurrentHashMap<>();
    private final Map<String, KeyValueStore> stateMachines = new ConcurrentHashMap<>();
    private final Map<String, RaftRpcHandler> clusterHandlers = new ConcurrentHashMap<>();
    private final Set<String> disconnectedPairs = ConcurrentHashMap.newKeySet();
    private final ExecutorService networkExecutor;

    public ClusterSimulator(File baseDir, int clusterSize) throws IOException {
        this.baseDir = baseDir;
        this.clusterSize = clusterSize;
        this.networkExecutor = Executors.newFixedThreadPool(clusterSize * 2, r -> {
            Thread t = new Thread(r, "sim-network");
            t.setDaemon(true);
            return t;
        });

        for (int i = 1; i <= clusterSize; i++) {
            nodeIds.add("node-" + i);
        }

        // Initialize each node with low timeouts for snappy tests (80ms - 160ms election, 25ms heartbeat)
        for (String nodeId : nodeIds) {
            startNode(nodeId, 80, 160, 25);
        }
    }

    public synchronized RaftNode startNode(String nodeId, long minElection, long maxElection, long heartbeat) throws IOException {
        File nodeDir = new File(baseDir, nodeId);
        if (!nodeDir.exists()) nodeDir.mkdirs();

        List<String> peers = new ArrayList<>(nodeIds);
        peers.remove(nodeId);

        RaftConfig config = new RaftConfig(nodeId, peers, minElection, maxElection, heartbeat, 100, 1000);
        WriteAheadLog wal = new WriteAheadLog(nodeDir, false); // in-memory fast write without fsync wait in test harness
        RaftMetaStorage meta = new RaftMetaStorage(nodeDir);
        KeyValueStore kv = new KeyValueStore();
        stateMachines.put(nodeId, kv);

        InProcessRaftTransport transport = new InProcessRaftTransport(nodeId, clusterHandlers, disconnectedPairs, networkExecutor);
        RaftNode node = new RaftNode(config, wal, meta, kv, transport);
        nodes.put(nodeId, node);
        node.start();

        return node;
    }

    public synchronized void killNode(String nodeId) throws IOException {
        RaftNode node = nodes.remove(nodeId);
        if (node != null) {
            log.info("Killing node {}", nodeId);
            node.close();
            clusterHandlers.remove(nodeId);
        }
    }

    public synchronized RaftNode restartNode(String nodeId) throws IOException {
        log.info("Restarting node {}", nodeId);
        return startNode(nodeId, 80, 160, 25);
    }

    public RaftNode waitForLeader(long timeoutMs) throws TimeoutException, InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            for (RaftNode node : nodes.values()) {
                if (node.getRole() == Role.LEADER) {
                    return node;
                }
            }
            Thread.sleep(20);
        }
        throw new TimeoutException("No leader elected within " + timeoutMs + "ms");
    }

    public void partition(Set<String> groupA, Set<String> groupB) {
        log.info("Creating network partition between {} and {}", groupA, groupB);
        for (String a : groupA) {
            for (String b : groupB) {
                disconnectedPairs.add(a + "->" + b);
                disconnectedPairs.add(b + "->" + a);
            }
        }
    }

    public void healPartition() {
        log.info("Healing all network partitions");
        disconnectedPairs.clear();
    }

    public CompletableFuture<ApplyResult> executeOnLeader(Command command) {
        RaftNode leader = null;
        for (RaftNode node : nodes.values()) {
            if (node.getRole() == Role.LEADER) {
                leader = node;
                break;
            }
        }
        if (leader == null) {
            CompletableFuture<ApplyResult> failed = new CompletableFuture<>();
            failed.completeExceptionally(new IllegalStateException("No leader currently present"));
            return failed;
        }
        return leader.execute(command);
    }

    public Map<String, RaftNode> getNodes() {
        return nodes;
    }

    public KeyValueStore getStateMachine(String nodeId) {
        return stateMachines.get(nodeId);
    }

    @Override
    public synchronized void close() throws IOException {
        for (RaftNode node : nodes.values()) {
            node.close();
        }
        nodes.clear();
        networkExecutor.shutdownNow();
    }
}
