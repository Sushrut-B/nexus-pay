package io.raftline.api.benchmark;

import io.raftline.api.redis.RaftRedisServer;
import io.raftline.api.redis.RespFrame;
import io.raftline.api.redis.RespParser;
import io.raftline.core.RaftNode;
import io.raftline.core.Role;
import io.raftline.core.config.RaftConfig;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.state.KeyValueStore;
import io.raftline.storage.wal.WriteAheadLog;
import io.raftline.transport.GrpcRaftTransport;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.IOException;
import java.net.Socket;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * High-Throughput Redis Protocol Benchmark for Raftline.
 * Simulates concurrent Redis client connections executing real-world
 * transactional workloads (SET, GET, INCR, HSET, LPUSH) over consensus.
 */
public class RedisDriverBenchmark {

    public static void main(String[] args) throws Exception {
        int threads = 10;
        int opsPerThread = 500;
        int port = 6379;
        String host = "127.0.0.1";
        String password = null;

        for (int i = 0; i < args.length; i++) {
            if ("--threads".equals(args[i]) && i + 1 < args.length) threads = Integer.parseInt(args[++i]);
            else if ("--ops".equals(args[i]) && i + 1 < args.length) opsPerThread = Integer.parseInt(args[++i]);
            else if ("--port".equals(args[i]) && i + 1 < args.length) port = Integer.parseInt(args[++i]);
            else if ("--host".equals(args[i]) && i + 1 < args.length) host = args[++i];
            else if ("--auth".equals(args[i]) && i + 1 < args.length) password = args[++i];
        }

        int totalOps = threads * opsPerThread;
        System.out.println("================================================================");
        System.out.println("   RAFTLINE REDIS PROTOCOL BENCHMARK SUITE");
        System.out.println("================================================================");
        System.out.printf("  Workers: %d threads | Ops/Worker: %d | Total Ops: %d%n", threads, opsPerThread, totalOps);
        System.out.printf("  Target: %s:%d%n", host, port);
        System.out.println("----------------------------------------------------------------");
        System.out.println("Workload mix: 40% SET, 40% GET, 10% INCR, 10% HSET...");

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Long> latencies = new CopyOnWriteArrayList<>();
        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger errorCount = new AtomicInteger(0);

        long startNs = System.nanoTime();
        CountDownLatch latch = new CountDownLatch(threads);

        for (int t = 0; t < threads; t++) {
            final int workerId = t;
            final String targetHost = host;
            final int targetPort = port;
            final String auth = password;
            final int ops = opsPerThread;

            pool.submit(() -> {
                try (Socket socket = new Socket(targetHost, targetPort);
                     BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream());
                     BufferedInputStream in = new BufferedInputStream(socket.getInputStream())) {

                    socket.setTcpNoDelay(true);

                    if (auth != null) {
                        sendCommand(out, "AUTH", auth);
                        RespParser.parse(in);
                    }

                    for (int i = 0; i < ops; i++) {
                        String key = "bench:worker:" + workerId + ":key:" + (i % 50);
                        String val = "val-" + UUID.randomUUID();
                        long opStart = System.nanoTime();

                        try {
                            int mod = i % 10;
                            if (mod < 4) {
                                // 40% SET (Consensus Write)
                                sendCommand(out, "SET", key, val);
                                RespFrame resp = RespParser.parse(in);
                                if (resp instanceof RespFrame.SimpleString ss && "OK".equals(ss.value())) {
                                    successCount.incrementAndGet();
                                } else {
                                    errorCount.incrementAndGet();
                                }
                            } else if (mod < 8) {
                                // 40% GET (0-Hop Leader Lease Read)
                                sendCommand(out, "GET", key);
                                RespFrame resp = RespParser.parse(in);
                                if (resp instanceof RespFrame.BulkString) {
                                    successCount.incrementAndGet();
                                } else {
                                    errorCount.incrementAndGet();
                                }
                            } else if (mod == 8) {
                                // 10% Atomic INCR
                                sendCommand(out, "INCR", "bench:counter:" + workerId);
                                RespFrame resp = RespParser.parse(in);
                                if (resp instanceof RespFrame.IntegerFrame) {
                                    successCount.incrementAndGet();
                                } else {
                                    errorCount.incrementAndGet();
                                }
                            } else {
                                // 10% HSET Hash
                                sendCommand(out, "HSET", "bench:hash:" + workerId, "f" + (i % 5), val);
                                RespFrame resp = RespParser.parse(in);
                                if (resp instanceof RespFrame.IntegerFrame) {
                                    successCount.incrementAndGet();
                                } else {
                                    errorCount.incrementAndGet();
                                }
                            }
                            latencies.add(System.nanoTime() - opStart);
                        } catch (Exception e) {
                            errorCount.incrementAndGet();
                        }
                    }
                } catch (Exception e) {
                    System.err.printf("Worker %d socket error: %s%n", workerId, e.getMessage());
                } finally {
                    latch.countDown();
                }
            });
        }

        latch.await(3, TimeUnit.MINUTES);
        long durationNs = System.nanoTime() - startNs;
        pool.shutdown();

        printReport(durationNs, successCount.get(), errorCount.get(), latencies);
    }

    private static void sendCommand(BufferedOutputStream out, String... args) throws IOException {
        RespFrame[] elements = new RespFrame[args.length];
        for (int i = 0; i < args.length; i++) {
            elements[i] = RespFrame.BulkString.of(args[i]);
        }
        RespFrame.Array array = new RespFrame.Array(List.of(elements));
        out.write(array.encode());
        out.flush();
    }

    private static void printReport(long durationNs, int successes, int errors, List<Long> latencies) {
        double durationSec = durationNs / 1_000_000_000.0;
        int total = successes + errors;
        double throughput = total / durationSec;

        Collections.sort(latencies);
        double p50 = percentile(latencies, 50.0);
        double p90 = percentile(latencies, 90.0);
        double p95 = percentile(latencies, 95.0);
        double p99 = percentile(latencies, 99.0);

        System.out.println("================================================================");
        System.out.println("   BENCHMARK EXECUTION RESULTS");
        System.out.println("================================================================");
        System.out.printf("  Duration:              %.3f seconds%n", durationSec);
        System.out.printf("  Completed Ops:         %d%n", total);
        System.out.printf("  Successful:            %d (%.2f%%)%n", successes, (successes * 100.0 / Math.max(1, total)));
        System.out.printf("  Errors:                %d%n", errors);
        System.out.printf("  Throughput:            %,.2f ops/sec%n", throughput);
        System.out.println("----------------------------------------------------------------");
        System.out.println("  Latency Distribution (Client-Observed roundtrip):");
        System.out.printf("    P50:                 %.3f ms%n", p50);
        System.out.printf("    P90:                 %.3f ms%n", p90);
        System.out.printf("    P95:                 %.3f ms%n", p95);
        System.out.printf("    P99:                 %.3f ms%n", p99);
        System.out.println("================================================================");
    }

    private static double percentile(List<Long> sorted, double pct) {
        if (sorted.isEmpty()) return 0.0;
        int idx = (int) Math.ceil((pct / 100.0) * sorted.size()) - 1;
        idx = Math.max(0, Math.min(idx, sorted.size() - 1));
        return sorted.get(idx) / 1_000_000.0;
    }
}
