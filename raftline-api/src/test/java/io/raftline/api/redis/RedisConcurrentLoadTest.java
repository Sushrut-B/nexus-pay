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

import java.io.*;
import java.net.Socket;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

public class RedisConcurrentLoadTest {

    @TempDir
    File tempDir;

    private final List<RaftNode> nodes = new ArrayList<>();
    private RaftRedisServer redisServer;
    private int redisPort;

    @BeforeEach
    void setUp() throws Exception {
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9951,
                "node-2", 9952,
                "node-3", 9953
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
            // In multi-client concurrency tests, disk fsync can introduce brief delays.
            // Using 800-1600ms election timeout and 80ms heartbeats prevents spurious leader re-elections.
            RaftConfig cfg = new RaftConfig(id, peers, 800, 1600, 80, 500, 10000, true);
            GrpcRaftTransport transport = new GrpcRaftTransport(id, grpcPorts.get(id), grpcAddrs);

            RaftNode node = new RaftNode(cfg, wal, meta, state, transport);
            nodes.add(node);
            node.start();
        }

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

        redisServer = new RaftRedisServer(0, this::getClusterLeader, null);
        redisServer.start();
        redisPort = redisServer.getPort();
    }

    private RaftNode getClusterLeader() {
        for (RaftNode n : nodes) {
            if (n.getRole() == Role.LEADER) {
                return n;
            }
        }
        return nodes.isEmpty() ? null : nodes.get(0);
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
    void testConcurrentClientsMixedWorkload() throws Exception {
        int clientCount = 3;
        int opsPerClient = 25;
        ExecutorService executor = Executors.newFixedThreadPool(clientCount);
        CountDownLatch latch = new CountDownLatch(clientCount);
        AtomicInteger totalSuccess = new AtomicInteger(0);

        List<String> failures = new CopyOnWriteArrayList<>();
        for (int c = 0; c < clientCount; c++) {
            final int clientId = c;
            executor.submit(() -> {
                try (Socket socket = new Socket("localhost", redisPort);
                     BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream());
                     BufferedInputStream in = new BufferedInputStream(socket.getInputStream())) {

                    for (int i = 0; i < opsPerClient; i++) {
                        String key = "bench:" + clientId + ":" + (i % 10);
                        String val = "v-" + i;

                        // 1. SET
                        RespFrame f1 = sendWithRetry(out, in, "SET", key, val);
                        if (!(f1 instanceof RespFrame.SimpleString)) {
                            failures.add("SET failed for " + key + ": " + f1);
                            return;
                        }

                        // 2. GET
                        RespFrame f2 = sendWithRetry(out, in, "GET", key);
                        if (!(f2 instanceof RespFrame.BulkString bs) || !val.equals(bs.asString())) {
                            failures.add("GET failed for " + key + ": " + f2 + " (expected " + val + ")");
                            return;
                        }

                        // 3. INCR
                        RespFrame f3 = sendWithRetry(out, in, "INCR", "counter:" + clientId);
                        if (!(f3 instanceof RespFrame.IntegerFrame)) {
                            failures.add("INCR failed for client " + clientId + ": " + f3);
                            return;
                        }

                        totalSuccess.incrementAndGet();
                    }
                } catch (Throwable e) {
                    failures.add("Client " + clientId + " exception: " + e.getMessage());
                } finally {
                    latch.countDown();
                }
            });
        }

        boolean finished = latch.await(60, TimeUnit.SECONDS);
        assertThat(finished).isTrue();
        assertThat(failures).isEmpty();
        assertThat(totalSuccess.get()).isEqualTo(clientCount * opsPerClient);
        executor.shutdown();
    }

    private RespFrame sendWithRetry(BufferedOutputStream out, BufferedInputStream in, String... args) throws Exception {
        for (int attempt = 0; attempt < 10; attempt++) {
            send(out, args);
            RespFrame resp = RespParser.parse(in);
            if (resp instanceof RespFrame.Error err && (err.message().contains("MOVED") || err.message().contains("NotLeaderException") || err.message().contains("TimeoutException"))) {
                Thread.sleep(150);
                continue;
            }
            return resp;
        }
        send(out, args);
        return RespParser.parse(in);
    }

    private void send(BufferedOutputStream out, String... args) throws IOException {
        RespFrame[] elements = new RespFrame[args.length];
        for (int i = 0; i < args.length; i++) {
            elements[i] = RespFrame.BulkString.of(args[i]);
        }
        RespFrame.Array array = new RespFrame.Array(List.of(elements));
        out.write(array.encode());
        out.flush();
    }
}
