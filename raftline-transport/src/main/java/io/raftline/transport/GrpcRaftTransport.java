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

    // Fault injection configuration
    private final java.util.Set<String> isolatedPeers = ConcurrentHashMap.newKeySet();
    private final Map<String, Long> peerDelaysMs = new ConcurrentHashMap<>();
    private final Map<String, Double> peerDropRates = new ConcurrentHashMap<>();

    @Override
    public void isolatePeer(String peerId) {
        isolatedPeers.add(peerId);
        log.warn("Node {} isolated peer {}", localNodeId, peerId);
    }

    @Override
    public void healPeer(String peerId) {
        isolatedPeers.remove(peerId);
        peerDelaysMs.remove(peerId);
        peerDropRates.remove(peerId);
        log.info("Node {} healed peer {}", localNodeId, peerId);
    }

    @Override
    public void healAll() {
        isolatedPeers.clear();
        peerDelaysMs.clear();
        peerDropRates.clear();
        log.info("Node {} healed all peers", localNodeId);
    }

    @Override
    public void setPeerDelay(String peerId, long delayMs) {
        if (delayMs <= 0) peerDelaysMs.remove(peerId);
        else peerDelaysMs.put(peerId, delayMs);
    }

    @Override
    public void setPeerDropRate(String peerId, double dropRate) {
        if (dropRate <= 0.0) peerDropRates.remove(peerId);
        else peerDropRates.put(peerId, Math.min(1.0, dropRate));
    }

    @Override
    public boolean isPeerIsolated(String peerId) {
        return isolatedPeers.contains(peerId);
    }

    @Override
    public java.util.Set<String> getIsolatedPeers() {
        return java.util.Set.copyOf(isolatedPeers);
    }

    @Override
    public Map<String, Long> getPeerDelays() {
        return Map.copyOf(peerDelaysMs);
    }

    @Override
    public Map<String, Double> getPeerDropRates() {
        return Map.copyOf(peerDropRates);
    }

    private boolean shouldDropOrIsolate(String peerId, CompletableFuture<?> future) {
        if (isPeerIsolated(peerId)) {
            future.completeExceptionally(new java.util.concurrent.TimeoutException("Peer " + peerId + " is isolated (chaos)"));
            return true;
        }
        Double dropRate = peerDropRates.get(peerId);
        if (dropRate != null && java.util.concurrent.ThreadLocalRandom.current().nextDouble() < dropRate) {
            future.completeExceptionally(new java.util.concurrent.TimeoutException("Packet to " + peerId + " dropped (chaos drop rate " + dropRate + ")"));
            return true;
        }
        return false;
    }

    @Override
    public CompletableFuture<RequestVoteResponse> sendRequestVote(String peerId, RequestVoteRequest request) {
        CompletableFuture<RequestVoteResponse> future = new CompletableFuture<>();
        if (shouldDropOrIsolate(peerId, future)) {
            return future;
        }
        Long delay = peerDelaysMs.get(peerId);
        if (delay != null && delay > 0) {
            CompletableFuture.delayedExecutor(delay, TimeUnit.MILLISECONDS).execute(() -> {
                sendRequestVoteInternal(peerId, request, future);
            });
            return future;
        }
        sendRequestVoteInternal(peerId, request, future);
        return future;
    }

    private void sendRequestVoteInternal(String peerId, RequestVoteRequest request, CompletableFuture<RequestVoteResponse> future) {
        try {
            RaftInternalServiceGrpc.RaftInternalServiceFutureStub stub = getStub(peerId);
            RequestVoteProto protoReq = ProtoConverter.toProto(request);
            ListenableFuture<RequestVoteResponseProto> rpcFuture = stub
                    .withDeadlineAfter(2500, TimeUnit.MILLISECONDS)
                    .requestVote(protoReq);

            toCompletableFuture(rpcFuture)
                    .thenApply(ProtoConverter::fromProto)
                    .whenComplete((res, ex) -> {
                        if (ex != null) future.completeExceptionally(ex);
                        else future.complete(res);
                    });
        } catch (Exception e) {
            future.completeExceptionally(e);
        }
    }

    @Override
    public CompletableFuture<AppendEntriesResponse> sendAppendEntries(String peerId, AppendEntriesRequest request) {
        CompletableFuture<AppendEntriesResponse> future = new CompletableFuture<>();
        if (shouldDropOrIsolate(peerId, future)) {
            return future;
        }
        Long delay = peerDelaysMs.get(peerId);
        if (delay != null && delay > 0) {
            CompletableFuture.delayedExecutor(delay, TimeUnit.MILLISECONDS).execute(() -> {
                sendAppendEntriesInternal(peerId, request, future);
            });
            return future;
        }
        sendAppendEntriesInternal(peerId, request, future);
        return future;
    }

    private void sendAppendEntriesInternal(String peerId, AppendEntriesRequest request, CompletableFuture<AppendEntriesResponse> future) {
        try {
            RaftInternalServiceGrpc.RaftInternalServiceFutureStub stub = getStub(peerId);
            AppendEntriesProto protoReq = ProtoConverter.toProto(request);
            ListenableFuture<AppendEntriesResponseProto> rpcFuture = stub
                    .withDeadlineAfter(2500, TimeUnit.MILLISECONDS)
                    .appendEntries(protoReq);

            toCompletableFuture(rpcFuture)
                    .thenApply(ProtoConverter::fromProto)
                    .whenComplete((res, ex) -> {
                        if (ex != null) future.completeExceptionally(ex);
                        else future.complete(res);
                    });
        } catch (Exception e) {
            future.completeExceptionally(e);
        }
    }

    @Override
    public CompletableFuture<InstallSnapshotResponse> sendInstallSnapshot(String peerId, InstallSnapshotRequest request) {
        CompletableFuture<InstallSnapshotResponse> future = new CompletableFuture<>();
        if (shouldDropOrIsolate(peerId, future)) {
            return future;
        }
        Long delay = peerDelaysMs.get(peerId);
        if (delay != null && delay > 0) {
            CompletableFuture.delayedExecutor(delay, TimeUnit.MILLISECONDS).execute(() -> {
                sendInstallSnapshotInternal(peerId, request, future);
            });
            return future;
        }
        sendInstallSnapshotInternal(peerId, request, future);
        return future;
    }

    private void sendInstallSnapshotInternal(String peerId, InstallSnapshotRequest request, CompletableFuture<InstallSnapshotResponse> future) {
        try {
            RaftInternalServiceGrpc.RaftInternalServiceFutureStub stub = getStub(peerId);
            InstallSnapshotProto protoReq = ProtoConverter.toProto(request);
            ListenableFuture<InstallSnapshotResponseProto> rpcFuture = stub
                    .withDeadlineAfter(5000, TimeUnit.MILLISECONDS)
                    .installSnapshot(protoReq);

            toCompletableFuture(rpcFuture)
                    .thenApply(ProtoConverter::fromProto)
                    .whenComplete((res, ex) -> {
                        if (ex != null) future.completeExceptionally(ex);
                        else future.complete(res);
                    });
        } catch (Exception e) {
            future.completeExceptionally(e);
        }
    }

    @Override
    public void close() {
        isolatedPeers.clear();
        peerDelaysMs.clear();
        peerDropRates.clear();
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

