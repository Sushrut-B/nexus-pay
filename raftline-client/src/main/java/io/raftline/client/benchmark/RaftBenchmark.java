package io.raftline.client.benchmark;

import io.raftline.client.QuorixClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Enterprise Performance Benchmark & Load Generator for Raftline.
 * Simulates high-concurrency client workloads across the Raft cluster, measuring:
 * - Throughput (operations / second)
 * - P50, P90, P95, P99 Latency percentiles
 * - Read/Write/Scan mix workloads
 * - Error and failover resilience
 */
public class RaftBenchmark {
    private static final Logger log = LoggerFactory.getLogger(RaftBenchmark.class);

    public static void main(String[] args) throws Exception {
        int threads = 8;
        int opsPerThread = 500;
        String[] seeds = new String[]{
                "http://localhost:8001", "http://localhost:8002",
                "http://localhost:8003", "http://localhost:8004", "http://localhost:8005"
        };

        for (int i = 0; i < args.length; i++) {
            if ("--threads".equals(args[i]) && i + 1 < args.length) {
                threads = Integer.parseInt(args[++i]);
            } else if ("--ops".equals(args[i]) && i + 1 < args.length) {
                opsPerThread = Integer.parseInt(args[++i]);
            } else if ("--servers".equals(args[i]) && i + 1 < args.length) {
                seeds = args[++i].split(",");
            }
        }

        int totalOps = threads * opsPerThread;
        System.out.println("================================================================");
        System.out.println("   RAFTLINE CLUSTER HIGH-PERFORMANCE BENCHMARK SUITE");
        System.out.println("================================================================");
        System.out.printf("  Workers: %d threads | Ops/Worker: %d | Total Ops: %d%n", threads, opsPerThread, totalOps);
        System.out.printf("  Target Cluster: %s%n", Arrays.toString(seeds));
        System.out.println("----------------------------------------------------------------");
        System.out.println("Starting workload (40% PUT, 40% GET, 20% SCAN)...");

        ExecutorService executor = Executors.newFixedThreadPool(threads);
        List<Long> latencies = new CopyOnWriteArrayList<>();
        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger errorCount = new AtomicInteger(0);

        long startNs = System.nanoTime();
        CountDownLatch latch = new CountDownLatch(threads);

        final String[] clusterSeeds = seeds;
        final int perThread = opsPerThread;

        for (int t = 0; t < threads; t++) {
            final int threadId = t;
            executor.submit(() -> {
                try (QuorixClient client = QuorixClient.create(clusterSeeds)) {
                    Random rand = new Random(threadId);
                    for (int i = 0; i < perThread; i++) {
                        String key = "bench:key:" + (rand.nextInt(1000));
                        String val = "payload-" + UUID.randomUUID();

                        long opStart = System.nanoTime();
                        try {
                            int dice = rand.nextInt(100);
                            if (dice < 40) {
                                // 40% Writes (PUT)
                                client.put(key, val);
                            } else if (dice < 80) {
                                // 40% Reads (GET)
                                client.get(key);
                            } else {
                                // 20% Range Scans
                                client.scan("bench:key:100", "bench:key:200", 20);
                            }
                            long elapsedMs = (System.nanoTime() - opStart) / 1_000_000;
                            latencies.add(elapsedMs);
                            successCount.incrementAndGet();
                        } catch (Exception e) {
                            errorCount.incrementAndGet();
                        }
                    }
                } catch (Exception e) {
                    log.error("Worker {} encountered fatal error", threadId, e);
                } finally {
                    latch.countDown();
                }
            });
        }

        latch.await();
        long totalDurationMs = (System.nanoTime() - startNs) / 1_000_000;
        executor.shutdown();

        // Compute percentiles
        List<Long> sorted = new ArrayList<>(latencies);
        Collections.sort(sorted);

        double opsPerSec = (totalDurationMs > 0) ? (successCount.get() * 1000.0) / totalDurationMs : 0;
        long p50 = sorted.isEmpty() ? 0 : sorted.get((int) (sorted.size() * 0.50));
        long p90 = sorted.isEmpty() ? 0 : sorted.get((int) (sorted.size() * 0.90));
        long p95 = sorted.isEmpty() ? 0 : sorted.get((int) (sorted.size() * 0.95));
        long p99 = sorted.isEmpty() ? 0 : sorted.get((int) (sorted.size() * 0.99));
        long min = sorted.isEmpty() ? 0 : sorted.get(0);
        long max = sorted.isEmpty() ? 0 : sorted.get(sorted.size() - 1);

        System.out.println("================================================================");
        System.out.println("                      BENCHMARK RESULTS                         ");
        System.out.println("================================================================");
        System.out.printf("  Completed Operations:  %d%n", successCount.get());
        System.out.printf("  Failed Operations:     %d%n", errorCount.get());
        System.out.printf("  Total Elapsed Time:    %.2f seconds (%d ms)%n", totalDurationMs / 1000.0, totalDurationMs);
        System.out.printf("  Overall Throughput:    %.2f ops/second%n", opsPerSec);
        System.out.println("----------------------------------------------------------------");
        System.out.println("  LATENCY DISTRIBUTION (ms):");
        System.out.printf("    Min:  %d ms%n", min);
        System.out.printf("    P50:  %d ms%n", p50);
        System.out.printf("    P90:  %d ms%n", p90);
        System.out.printf("    P95:  %d ms%n", p95);
        System.out.printf("    P99:  %d ms%n", p99);
        System.out.printf("    Max:  %d ms%n", max);
        System.out.println("================================================================");
    }
}
