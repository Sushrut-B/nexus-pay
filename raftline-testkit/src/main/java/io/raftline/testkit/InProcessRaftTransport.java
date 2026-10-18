package io.raftline.testkit;

import io.raftline.core.rpc.*;
import io.raftline.core.transport.RaftRpcHandler;
import io.raftline.core.transport.RaftTransport;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.*;

/**
 * In-memory simulated network transport for ultra-fast, deterministic cluster testing.
 * Supports simulating bidirectional partitions, unidirectional drops, message delay, and packet drop rates.
 */
public class InProcessRaftTransport implements RaftTransport {
    private final String localNodeId;
    private final Map<String, RaftRpcHandler> clusterHandlers;
    private final Set<String> disconnectedPairs;
    private final ExecutorService networkExecutor;

    // Fault injection configurations
    private final Map<String, Long> peerDelaysMs = new ConcurrentHashMap<>();
    private final Map<String, Double> peerDropRates = new ConcurrentHashMap<>();

    private RaftRpcHandler localHandler;

    public InProcessRaftTransport(String localNodeId,
                                  Map<String, RaftRpcHandler> clusterHandlers,
                                  Set<String> disconnectedPairs,
                                  ExecutorService networkExecutor) {
        this.localNodeId = localNodeId;
        this.clusterHandlers = clusterHandlers;
        this.disconnectedPairs = disconnectedPairs;
        this.networkExecutor = networkExecutor;
    }

    @Override
    public void registerHandler(RaftRpcHandler handler) {
        this.localHandler = handler;
        this.clusterHandlers.put(localNodeId, handler);
    }

    public void setPeerDelay(String peerId, long delayMs) {
        if (delayMs <= 0) {
            peerDelaysMs.remove(peerId);
        } else {
            peerDelaysMs.put(peerId, delayMs);
        }
    }

    public void setPeerDropRate(String peerId, double dropRate) {
        if (dropRate <= 0.0) {
            peerDropRates.remove(peerId);
        } else {
            peerDropRates.put(peerId, dropRate);
        }
    }

    private boolean isPartitioned(String targetPeerId) {
        String directed = localNodeId + "->" + targetPeerId;
        if (disconnectedPairs.contains(directed)) {
            return true;
        }
        Double dropRate = peerDropRates.get(targetPeerId);
        if (dropRate != null && ThreadLocalRandom.current().nextDouble() < dropRate) {
            return true;
        }
        return false;
    }

    private void applyDelayIfConfigured(String peerId) {
        Long delay = peerDelaysMs.get(peerId);
        if (delay != null && delay > 0) {
            try {
                Thread.sleep(delay);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
    }

    @Override
    public CompletableFuture<RequestVoteResponse> sendRequestVote(String peerId, RequestVoteRequest request) {
        CompletableFuture<RequestVoteResponse> future = new CompletableFuture<>();
        if (isPartitioned(peerId)) {
            future.completeExceptionally(new TimeoutException("Network partitioned from " + peerId));
            return future;
        }

        RaftRpcHandler handler = clusterHandlers.get(peerId);
        if (handler == null) {
            future.completeExceptionally(new IllegalStateException("Unknown peer: " + peerId));
            return future;
        }

        networkExecutor.execute(() -> {
            try {
                applyDelayIfConfigured(peerId);
                if (isPartitioned(peerId)) {
                    future.completeExceptionally(new TimeoutException("Network partitioned from " + peerId));
                } else {
                    RequestVoteResponse response = handler.handleRequestVote(request);
                    future.complete(response);
                }
            } catch (Exception e) {
                future.completeExceptionally(e);
            }
        });

        return future;
    }

    @Override
    public CompletableFuture<AppendEntriesResponse> sendAppendEntries(String peerId, AppendEntriesRequest request) {
        CompletableFuture<AppendEntriesResponse> future = new CompletableFuture<>();
        if (isPartitioned(peerId)) {
            future.completeExceptionally(new TimeoutException("Network partitioned from " + peerId));
            return future;
        }

        RaftRpcHandler handler = clusterHandlers.get(peerId);
        if (handler == null) {
            future.completeExceptionally(new IllegalStateException("Unknown peer: " + peerId));
            return future;
        }

        networkExecutor.execute(() -> {
            try {
                applyDelayIfConfigured(peerId);
                if (isPartitioned(peerId)) {
                    future.completeExceptionally(new TimeoutException("Network partitioned from " + peerId));
                } else {
                    AppendEntriesResponse response = handler.handleAppendEntries(request);
                    future.complete(response);
                }
            } catch (Exception e) {
                future.completeExceptionally(e);
            }
        });

        return future;
    }

    @Override
    public CompletableFuture<InstallSnapshotResponse> sendInstallSnapshot(String peerId, InstallSnapshotRequest request) {
        CompletableFuture<InstallSnapshotResponse> future = new CompletableFuture<>();
        if (isPartitioned(peerId)) {
            future.completeExceptionally(new TimeoutException("Network partitioned from " + peerId));
            return future;
        }

        RaftRpcHandler handler = clusterHandlers.get(peerId);
        if (handler == null) {
            future.completeExceptionally(new IllegalStateException("Unknown peer: " + peerId));
            return future;
        }

        networkExecutor.execute(() -> {
            try {
                applyDelayIfConfigured(peerId);
                if (isPartitioned(peerId)) {
                    future.completeExceptionally(new TimeoutException("Network partitioned from " + peerId));
                } else {
                    InstallSnapshotResponse response = handler.handleInstallSnapshot(request);
                    future.complete(response);
                }
            } catch (Exception e) {
                future.completeExceptionally(e);
            }
        });

        return future;
    }

    @Override
    public void close() {
        clusterHandlers.remove(localNodeId);
        peerDelaysMs.clear();
        peerDropRates.clear();
    }
}
