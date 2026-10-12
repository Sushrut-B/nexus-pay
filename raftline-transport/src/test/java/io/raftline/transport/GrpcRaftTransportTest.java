package io.raftline.transport;

import io.raftline.core.rpc.*;
import io.raftline.core.transport.RaftRpcHandler;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class GrpcRaftTransportTest {

    private GrpcRaftTransport transport1;
    private GrpcRaftTransport transport2;

    @AfterEach
    void tearDown() {
        if (transport1 != null) transport1.close();
        if (transport2 != null) transport2.close();
    }

    @Test
    void testGrpcCommunicationBetweenNodes() throws Exception {
        int port1 = 9811;
        int port2 = 9812;

        Map<String, String> peerAddresses1 = Map.of("node-2", "127.0.0.1:" + port2);
        Map<String, String> peerAddresses2 = Map.of("node-1", "127.0.0.1:" + port1);

        transport1 = new GrpcRaftTransport("node-1", port1, peerAddresses1);
        transport2 = new GrpcRaftTransport("node-2", port2, peerAddresses2);

        // Dummy handlers
        transport1.registerHandler(new DummyHandler());
        transport2.registerHandler(new DummyHandler());

        // Send RequestVote from node-1 to node-2 over real gRPC
        RequestVoteRequest voteReq = new RequestVoteRequest(1, "node-1", 10, 1);
        RequestVoteResponse voteRes = transport1.sendRequestVote("node-2", voteReq).get(3, TimeUnit.SECONDS);

        assertThat(voteRes).isNotNull();
        assertThat(voteRes.term()).isEqualTo(1);
        assertThat(voteRes.voteGranted()).isTrue();

        // Send AppendEntries from node-1 to node-2 over real gRPC
        AppendEntriesRequest appendReq = new AppendEntriesRequest(
                1, "node-1", 0, 0, Collections.emptyList(), 0
        );
        AppendEntriesResponse appendRes = transport1.sendAppendEntries("node-2", appendReq).get(3, TimeUnit.SECONDS);

        assertThat(appendRes).isNotNull();
        assertThat(appendRes.term()).isEqualTo(1);
        assertThat(appendRes.success()).isTrue();
    }

    private static class DummyHandler implements RaftRpcHandler {
        @Override
        public RequestVoteResponse handleRequestVote(RequestVoteRequest request) {
            return new RequestVoteResponse(request.term(), true);
        }

        @Override
        public AppendEntriesResponse handleAppendEntries(AppendEntriesRequest request) {
            return new AppendEntriesResponse(request.term(), true, 0);
        }

        @Override
        public InstallSnapshotResponse handleInstallSnapshot(InstallSnapshotRequest request) {
            return new InstallSnapshotResponse(request.term());
        }
    }
}
