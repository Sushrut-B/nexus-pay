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
}
