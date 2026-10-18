package io.raftline.api.redis;

import io.raftline.core.RaftNode;
import io.raftline.core.Role;
import io.raftline.core.config.RaftConfig;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.state.KeyValueStore;
import io.raftline.storage.wal.WriteAheadLog;
import io.raftline.transport.GrpcRaftTransport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.IOException;
import java.net.Socket;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

public class RaftRedisServerTest {

    @TempDir
    File tempDir;

    private final List<RaftNode> nodes = new ArrayList<>();
    private RaftRedisServer redisServer;
    private int redisPort;

    @BeforeEach
    void setUp() throws Exception {
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9941,
                "node-2", 9942,
                "node-3", 9943
        );

        for (String id : nodeIds) {
            File nDir = new File(tempDir, id);
            nDir.mkdirs();

            List<String> peers = new ArrayList<>(nodeIds);
            peers.remove(id);

            Map<String, String> grpcAddrs = new HashMap<>();
            for (String p : peers) {
                grpcAddrs.put(p, "localhost:" + grpcPorts.get(p));
            }

            WriteAheadLog wal = new WriteAheadLog(nDir, true);
            RaftMetaStorage meta = new RaftMetaStorage(nDir);
            KeyValueStore state = new KeyValueStore();
            RaftConfig cfg = new RaftConfig(id, peers);
            GrpcRaftTransport transport = new GrpcRaftTransport(id, grpcPorts.get(id), grpcAddrs);

            RaftNode node = new RaftNode(cfg, wal, meta, state, transport);
            nodes.add(node);
            node.start();
        }

        // Wait for leader
        RaftNode leader = null;
        for (int i = 0; i < 50; i++) {
            for (RaftNode n : nodes) {
                if (n.getRole() == Role.LEADER) {
                    leader = n;
                    break;
                }
            }
            if (leader != null) break;
            Thread.sleep(100);
        }
        assertThat(leader).isNotNull();

        // Start Redis server on dynamic ephemeral port 0 pointing to cluster leader
        redisServer = new RaftRedisServer(0, leader, null, "secret123");
        redisServer.start();
        redisPort = redisServer.getPort();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (redisServer != null) {
            redisServer.close();
        }
        for (RaftNode n : nodes) {
            try { n.close(); } catch (Exception ignored) {}
        }
    }

    @Test
    void testRedisAuthAndBasicSetGet() throws Exception {
        try (Socket socket = new Socket("localhost", redisPort);
             BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream());
             BufferedInputStream in = new BufferedInputStream(socket.getInputStream())) {

            // 1. Unauthenticated SET must fail with NOAUTH
            sendCommand(out, "SET", "mykey", "myval");
            RespFrame frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.Error.class);
            assertThat(((RespFrame.Error) frame).message()).contains("NOAUTH");

            // 2. Authenticate
            sendCommand(out, "AUTH", "secret123");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.SimpleString.class);
            assertThat(((RespFrame.SimpleString) frame).value()).isEqualTo("OK");

            // 3. SET mykey "hello-redis"
            sendCommand(out, "SET", "mykey", "hello-redis");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.SimpleString.class);
            assertThat(((RespFrame.SimpleString) frame).value()).isEqualTo("OK");

            // 4. GET mykey
            sendCommand(out, "GET", "mykey");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.BulkString.class);
            assertThat(((RespFrame.BulkString) frame).asString()).isEqualTo("hello-redis");

            // 5. INCR counter
            sendCommand(out, "INCR", "counter");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(1L);

            // 6. INCRBY counter 41
            sendCommand(out, "INCRBY", "counter", "41");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(42L);

            // 7. DEL mykey
            sendCommand(out, "DEL", "mykey");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(1L);

            // 8. GET deleted key -> null
            sendCommand(out, "GET", "mykey");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.BulkString.class);
            assertThat(((RespFrame.BulkString) frame).asString()).isNull();

            // 9. PING
            sendCommand(out, "PING");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.SimpleString.class);
            assertThat(((RespFrame.SimpleString) frame).value()).isEqualTo("PONG");
        }
    }

    private void sendCommand(BufferedOutputStream out, String... args) throws IOException {
        RespFrame[] elements = new RespFrame[args.length];
        for (int i = 0; i < args.length; i++) {
            elements[i] = RespFrame.BulkString.of(args[i]);
        }
        RespFrame.Array array = new RespFrame.Array(List.of(elements));
        out.write(array.encode());
        out.flush();
    }
}
