package io.raftline.transport;

import io.grpc.Server;
import io.grpc.ServerBuilder;
import io.grpc.stub.StreamObserver;
import io.raftline.core.rpc.*;
import io.raftline.core.transport.RaftRpcHandler;
import io.raftline.transport.proto.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;

public class GrpcRaftServer implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(GrpcRaftServer.class);

    private final int port;
    private final RaftRpcHandler handler;
    private Server server;

    public GrpcRaftServer(int port, RaftRpcHandler handler) {
        this.port = port;
        this.handler = handler;
    }

    public void start() throws IOException {
        this.server = io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder
                .forAddress(new java.net.InetSocketAddress("0.0.0.0", port))
                .addService(new RaftInternalServiceImpl())
                .build()
                .start();

        log.info("gRPC Raft Server started listening on port {}", port);
    }

    public int getPort() {
        return (server != null) ? server.getPort() : port;
    }

    @Override
    public void close() {
        if (server != null) {
            server.shutdown();
        }
    }

    private class RaftInternalServiceImpl extends RaftInternalServiceGrpc.RaftInternalServiceImplBase {
        @Override
        public void requestVote(RequestVoteProto request, StreamObserver<RequestVoteResponseProto> responseObserver) {
            try {
                RequestVoteRequest req = ProtoConverter.fromProto(request);
                RequestVoteResponse res = handler.handleRequestVote(req);
                responseObserver.onNext(ProtoConverter.toProto(res));
                responseObserver.onCompleted();
            } catch (Exception e) {
                log.error("Error handling requestVote RPC", e);
                responseObserver.onError(e);
            }
        }

        @Override
        public void appendEntries(AppendEntriesProto request, StreamObserver<AppendEntriesResponseProto> responseObserver) {
            try {
                AppendEntriesRequest req = ProtoConverter.fromProto(request);
                AppendEntriesResponse res = handler.handleAppendEntries(req);
                responseObserver.onNext(ProtoConverter.toProto(res));
                responseObserver.onCompleted();
            } catch (Exception e) {
                log.error("Error handling appendEntries RPC", e);
                responseObserver.onError(e);
            }
        }

        @Override
        public void installSnapshot(InstallSnapshotProto request, StreamObserver<InstallSnapshotResponseProto> responseObserver) {
            try {
                InstallSnapshotRequest req = ProtoConverter.fromProto(request);
                InstallSnapshotResponse res = handler.handleInstallSnapshot(req);
                responseObserver.onNext(ProtoConverter.toProto(res));
                responseObserver.onCompleted();
            } catch (Exception e) {
                log.error("Error handling installSnapshot RPC", e);
                responseObserver.onError(e);
            }
        }
    }
}
