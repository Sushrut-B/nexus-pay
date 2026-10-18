package io.raftline.transport;

import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.raftline.core.rpc.*;
import io.raftline.core.transport.RaftRpcHandler;
import io.raftline.core.transport.RaftTransport;
import io.raftline.transport.proto.*;
import io.raftline.transport.security.TlsConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

public class GrpcRaftTransport implements RaftTransport {
    private static final Logger log = LoggerFactory.getLogger(GrpcRaftTransport.class);

    private final String localNodeId;
    private final int localPort;
    private final Map<String, String> peerAddresses;
    private final TlsConfig tlsConfig;
    private final Map<String, ManagedChannel> channels = new ConcurrentHashMap<>();
    private final Map<String, RaftInternalServiceGrpc.RaftInternalServiceFutureStub> stubs = new ConcurrentHashMap<>();

    private GrpcRaftServer server;
    private RaftRpcHandler handler;

    public GrpcRaftTransport(String localNodeId, int localPort, Map<String, String> peerAddresses) {
        this(localNodeId, localPort, peerAddresses, TlsConfig.disabled());
    }

    public GrpcRaftTransport(String localNodeId, int localPort, Map<String, String> peerAddresses, TlsConfig tlsConfig) {
        this.localNodeId = Objects.requireNonNull(localNodeId, "localNodeId");
        this.localPort = localPort;
        this.peerAddresses = Objects.requireNonNull(peerAddresses, "peerAddresses");
        this.tlsConfig = tlsConfig != null ? tlsConfig : TlsConfig.disabled();
    }

    @Override
    public void registerHandler(RaftRpcHandler handler) {
        this.handler = handler;
        try {
            this.server = new GrpcRaftServer(localPort, handler, tlsConfig);
            this.server.start();
        } catch (IOException e) {
            throw new RuntimeException("Failed to bind gRPC server on port " + localPort, e);
        }
    }

    private synchronized RaftInternalServiceGrpc.RaftInternalServiceFutureStub getStub(String peerId) {
        return stubs.computeIfAbsent(peerId, id -> {
            String address = peerAddresses.get(id);
            if (address == null) {
                throw new IllegalArgumentException("Unknown peer address for: " + id);
            }
            String[] parts = address.split(":");
            String host = parts[0];
            int port = Integer.parseInt(parts[1]);

            var builder = io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder
                    .forAddress(new java.net.InetSocketAddress(host, port));

            if (tlsConfig.isEnabled()) {
                try {
                    var sslBuilder = io.grpc.netty.shaded.io.grpc.netty.GrpcSslContexts.forClient();
                    if (tlsConfig.getTrustCertCollectionFile() != null) {
                        sslBuilder.trustManager(tlsConfig.getTrustCertCollectionFile());
                    }
                    if (tlsConfig.getCertificateChainFile() != null && tlsConfig.getPrivateKeyFile() != null) {
                        sslBuilder.keyManager(tlsConfig.getCertificateChainFile(), tlsConfig.getPrivateKeyFile());
                    }
                    builder.sslContext(sslBuilder.build());
                    log.info("Configured TLS channel to peer {} at {}:{}", id, host, port);
                } catch (javax.net.ssl.SSLException e) {
                    throw new RuntimeException("Failed to initialize SSL context for channel to " + id, e);
                }
            } else {
                builder.usePlaintext();
            }

            ManagedChannel channel = builder.build();
            channels.put(id, channel);
            return RaftInternalServiceGrpc.newFutureStub(channel);
        });
    }

    private <T> CompletableFuture<T> toCompletableFuture(ListenableFuture<T> listenableFuture) {
        CompletableFuture<T> completableFuture = new CompletableFuture<>();
        Futures.addCallback(listenableFuture, new FutureCallback<T>() {
            @Override
            public void onSuccess(T result) {
                completableFuture.complete(result);
            }

            @Override
            public void onFailure(Throwable t) {
                completableFuture.completeExceptionally(t);
            }
        }, MoreExecutors.directExecutor());
        return completableFuture;
    }

    @Override
    public CompletableFuture<RequestVoteResponse> sendRequestVote(String peerId, RequestVoteRequest request) {
        try {
            RaftInternalServiceGrpc.RaftInternalServiceFutureStub stub = getStub(peerId);
            RequestVoteProto protoReq = ProtoConverter.toProto(request);
            ListenableFuture<RequestVoteResponseProto> future = stub
                    .withDeadlineAfter(500, TimeUnit.MILLISECONDS)
                    .requestVote(protoReq);

            return toCompletableFuture(future).thenApply(ProtoConverter::fromProto);
        } catch (Exception e) {
            CompletableFuture<RequestVoteResponse> failed = new CompletableFuture<>();
            failed.completeExceptionally(e);
            return failed;
        }
    }

    @Override
    public CompletableFuture<AppendEntriesResponse> sendAppendEntries(String peerId, AppendEntriesRequest request) {
        try {
            RaftInternalServiceGrpc.RaftInternalServiceFutureStub stub = getStub(peerId);
            AppendEntriesProto protoReq = ProtoConverter.toProto(request);
            ListenableFuture<AppendEntriesResponseProto> future = stub
                    .withDeadlineAfter(500, TimeUnit.MILLISECONDS)
                    .appendEntries(protoReq);

            return toCompletableFuture(future).thenApply(ProtoConverter::fromProto);
        } catch (Exception e) {
            CompletableFuture<AppendEntriesResponse> failed = new CompletableFuture<>();
            failed.completeExceptionally(e);
            return failed;
        }
    }

    @Override
    public CompletableFuture<InstallSnapshotResponse> sendInstallSnapshot(String peerId, InstallSnapshotRequest request) {
        try {
            RaftInternalServiceGrpc.RaftInternalServiceFutureStub stub = getStub(peerId);
            InstallSnapshotProto protoReq = ProtoConverter.toProto(request);
            ListenableFuture<InstallSnapshotResponseProto> future = stub
                    .withDeadlineAfter(5000, TimeUnit.MILLISECONDS)
                    .installSnapshot(protoReq);

            return toCompletableFuture(future).thenApply(ProtoConverter::fromProto);
        } catch (Exception e) {
            CompletableFuture<InstallSnapshotResponse> failed = new CompletableFuture<>();
            failed.completeExceptionally(e);
            return failed;
        }
    }

    @Override
    public void close() {
        if (server != null) {
            server.close();
        }
        for (ManagedChannel channel : channels.values()) {
            channel.shutdown();
        }
        channels.clear();
        stubs.clear();
    }
}
