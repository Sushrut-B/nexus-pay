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

    @Test
    void testRedisHashes() throws Exception {
        try (Socket socket = new Socket("localhost", redisPort);
             BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream());
             BufferedInputStream in = new BufferedInputStream(socket.getInputStream())) {

            sendCommand(out, "AUTH", "secret123");
            assertThat(RespParser.parse(in)).isInstanceOf(RespFrame.SimpleString.class);

            // 1. HSET user:100 name Alice role Admin
            sendCommand(out, "HSET", "user:100", "name", "Alice", "role", "Admin");
            RespFrame frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(2L);

            // 2. HGET user:100 name
            sendCommand(out, "HGET", "user:100", "name");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.BulkString.class);
            assertThat(((RespFrame.BulkString) frame).asString()).isEqualTo("Alice");

            // 3. HLEN user:100
            sendCommand(out, "HLEN", "user:100");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(2L);

            // 4. HDEL user:100 role
            sendCommand(out, "HDEL", "user:100", "role");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(1L);

            // 5. HGETALL user:100
            sendCommand(out, "HGETALL", "user:100");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.Array.class);
            assertThat(((RespFrame.Array) frame).elements()).hasSize(2);
        }
    }

    @Test
    void testRedisSets() throws Exception {
        try (Socket socket = new Socket("localhost", redisPort);
             BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream());
             BufferedInputStream in = new BufferedInputStream(socket.getInputStream())) {

            sendCommand(out, "AUTH", "secret123");
            assertThat(RespParser.parse(in)).isInstanceOf(RespFrame.SimpleString.class);

            // 1. SADD tags AI Consensus Database
            sendCommand(out, "SADD", "tags", "AI", "Consensus", "Database");
            RespFrame frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(3L);

            // 2. SCARD tags
            sendCommand(out, "SCARD", "tags");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(3L);

            // 3. SISMEMBER tags AI
            sendCommand(out, "SISMEMBER", "tags", "AI");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(1L);

            // 4. SREM tags Database
            sendCommand(out, "SREM", "tags", "Database");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(1L);

            // 5. SMEMBERS tags
            sendCommand(out, "SMEMBERS", "tags");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.Array.class);
            assertThat(((RespFrame.Array) frame).elements()).hasSize(2);
        }
    }

    @Test
    void testRedisAtomicListsAndQueues() throws Exception {
        try (Socket socket = new Socket("localhost", redisPort);
             BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream());
             BufferedInputStream in = new BufferedInputStream(socket.getInputStream())) {

            sendCommand(out, "AUTH", "secret123");
            assertThat(RespParser.parse(in)).isInstanceOf(RespFrame.SimpleString.class);

            // 1. RPUSH queue job1 job2 job3
            sendCommand(out, "RPUSH", "queue", "job1", "job2", "job3");
            RespFrame frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(3L);

            // 2. LPUSH queue job0
            sendCommand(out, "LPUSH", "queue", "job0");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(4L);

            // 3. LLEN queue
            sendCommand(out, "LLEN", "queue");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.IntegerFrame.class);
            assertThat(((RespFrame.IntegerFrame) frame).value()).isEqualTo(4L);

            // 4. LPOP queue -> job0
            sendCommand(out, "LPOP", "queue");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.BulkString.class);
            assertThat(((RespFrame.BulkString) frame).asString()).isEqualTo("job0");

            // 5. RPOP queue -> job3
            sendCommand(out, "RPOP", "queue");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.BulkString.class);
            assertThat(((RespFrame.BulkString) frame).asString()).isEqualTo("job3");

            // 6. LRANGE queue 0 -1 -> job1, job2
            sendCommand(out, "LRANGE", "queue", "0", "-1");
            frame = RespParser.parse(in);
            assertThat(frame).isInstanceOf(RespFrame.Array.class);
            assertThat(((RespFrame.Array) frame).elements()).hasSize(2);
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
