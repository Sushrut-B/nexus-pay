package io.raftline.core.transport;

import io.raftline.core.rpc.*;

import java.io.Closeable;
import java.util.concurrent.CompletableFuture;

/**
 * Transport abstraction for inter-node communication.
 * Allows pure in-memory deterministic simulation in tests,
 * and gRPC streaming in production.
 */
public interface RaftTransport extends Closeable {
    void registerHandler(RaftRpcHandler handler);

    CompletableFuture<RequestVoteResponse> sendRequestVote(String peerId, RequestVoteRequest request);

    CompletableFuture<AppendEntriesResponse> sendAppendEntries(String peerId, AppendEntriesRequest request);

    CompletableFuture<InstallSnapshotResponse> sendInstallSnapshot(String peerId, InstallSnapshotRequest request);

    // =========================================================================
    // Chaos & Fault Injection Hooks
    // =========================================================================
    default void isolatePeer(String peerId) {}
    default void healPeer(String peerId) {}
    default void healAll() {}
    default void setPeerDelay(String peerId, long delayMs) {}
    default void setPeerDropRate(String peerId, double dropRate) {}
    default boolean isPeerIsolated(String peerId) { return false; }
    default java.util.Set<String> getIsolatedPeers() { return java.util.Set.of(); }
    default java.util.Map<String, Long> getPeerDelays() { return java.util.Map.of(); }
    default java.util.Map<String, Double> getPeerDropRates() { return java.util.Map.of(); }
}

