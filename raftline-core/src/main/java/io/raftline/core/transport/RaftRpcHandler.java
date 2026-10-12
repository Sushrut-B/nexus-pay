package io.raftline.core.transport;

import io.raftline.core.rpc.*;

public interface RaftRpcHandler {
    RequestVoteResponse handleRequestVote(RequestVoteRequest request);
    AppendEntriesResponse handleAppendEntries(AppendEntriesRequest request);
    InstallSnapshotResponse handleInstallSnapshot(InstallSnapshotRequest request);
}
