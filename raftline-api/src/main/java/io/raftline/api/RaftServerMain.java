package io.raftline.api;

import io.raftline.core.RaftNode;
import io.raftline.core.config.RaftConfig;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.state.KeyValueStore;
import io.raftline.storage.wal.WriteAheadLog;
import io.raftline.transport.GrpcRaftTransport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.util.*;

/**
 * Main application bootstrap for running an independent Raftline database node.
 */
public class RaftServerMain {
    private static final Logger log = LoggerFactory.getLogger(RaftServerMain.class);

    public static void main(String[] args) throws Exception {
        Map<String, String> params = parseArgs(args);

        String nodeId = params.getOrDefault("id", "node-1");
        int httpPort = Integer.parseInt(params.getOrDefault("http-port", "8001"));
        int grpcPort = Integer.parseInt(params.getOrDefault("grpc-port", "9001"));
        String dataDirPath = params.getOrDefault("data-dir", "data/" + nodeId);
        String peersArg = params.getOrDefault("peers", "");

        File dataDir = new File(dataDirPath);
        if (!dataDir.exists()) dataDir.mkdirs();

        List<String> peerIds = new ArrayList<>();
        Map<String, String> grpcPeerAddresses = new HashMap<>();
        Map<String, Integer> httpPeerPorts = new HashMap<>();

        if (!peersArg.isBlank()) {
            // Format: node-2=host:grpcPort:httpPort,node-3=...
            for (String peerDef : peersArg.split(",")) {
                String[] parts = peerDef.trim().split("=");
                if (parts.length == 2) {
                    String peerId = parts[0];
                    String[] addrParts = parts[1].split(":");
                    String host = addrParts[0];
                    int peerGrpcPort = Integer.parseInt(addrParts[1]);
                    int peerHttpPort = (addrParts.length >= 3) ? Integer.parseInt(addrParts[2]) : peerGrpcPort - 1000;

                    peerIds.add(peerId);
                    grpcPeerAddresses.put(peerId, host + ":" + peerGrpcPort);
                    httpPeerPorts.put(peerId, peerHttpPort);
                }
            }
        }

        log.info("Starting Raftline node '{}' (HTTP: {}, gRPC: {}, DataDir: {}) with peers: {}",
                nodeId, httpPort, grpcPort, dataDir.getAbsolutePath(), peerIds);

        WriteAheadLog wal = new WriteAheadLog(dataDir, true);
        RaftMetaStorage metaStorage = new RaftMetaStorage(dataDir);
        KeyValueStore stateMachine = new KeyValueStore();

        RaftConfig config = new RaftConfig(nodeId, peerIds);
        GrpcRaftTransport transport = new GrpcRaftTransport(nodeId, grpcPort, grpcPeerAddresses);

        RaftNode raftNode = new RaftNode(config, wal, metaStorage, stateMachine, transport);
        raftNode.start();

        int redisPort = Integer.parseInt(params.getOrDefault("redis-port", "6379"));
        String redisAuth = params.get("redis-auth");

        RaftHttpServer httpServer = new RaftHttpServer(httpPort, raftNode, httpPeerPorts);
        httpServer.start();

        io.raftline.api.redis.RaftRedisServer redisServer = null;
        if (redisPort > 0) {
            try {
                redisServer = new io.raftline.api.redis.RaftRedisServer(redisPort, raftNode, null, redisAuth);
                redisServer.start();
                log.info("Redis RESP wire protocol enabled on port {}", redisServer.getPort());
            } catch (Exception e) {
                log.warn("Could not bind Redis RESP server to port {}: {}", redisPort, e.getMessage());
            }
        }

        final io.raftline.api.redis.RaftRedisServer finalRedisServer = redisServer;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log.info("Gracefully shutting down Raftline node '{}'...", nodeId);
            if (finalRedisServer != null) {
                try { finalRedisServer.close(); } catch (Exception ignored) {}
            }
            httpServer.close();
            try {
                raftNode.close();
            } catch (Exception e) {
                log.error("Error shutting down RaftNode", e);
            }
        }));

        long currentPid = ProcessHandle.current().pid();
        java.nio.file.Files.writeString(new File(dataDir, "node.pid").toPath(), String.valueOf(currentPid));
        log.info("Raftline node '{}' (PID: {}, Redis: {}) initialized successfully.", nodeId, currentPid, redisPort);

        try {
            Thread.currentThread().join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static Map<String, String> parseArgs(String[] args) {
        Map<String, String> map = new HashMap<>();
        for (String arg : args) {
            if (arg.startsWith("--") && arg.contains("=")) {
                String[] split = arg.substring(2).split("=", 2);
                map.put(split[0], split[1]);
            }
        }
        return map;
    }
}
