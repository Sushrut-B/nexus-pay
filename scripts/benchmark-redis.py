"""
Raftline Multi-Client Python Load Generator & Compatibility Verification
Uses the official enterprise redis-py driver to test and benchmark Raftline.
"""
import sys
import time
import uuid
import threading
import argparse
from concurrent.futures import ThreadPoolExecutor

try:
    import redis
except ImportError:
    print("[ERROR] redis-py not installed. Run: pip install redis")
    sys.exit(1)


def worker_task(worker_id, host, port, password, ops, results, errors, latencies):
    try:
        r = redis.Redis(
            host=host,
            port=port,
            password=password if password else None,
            socket_timeout=10,
            decode_responses=True
        )

        # Confirm connectivity
        r.ping()

        for i in range(ops):
            key = f"py:bench:{worker_id}:{i % 50}"
            val = f"val-{uuid.uuid4().hex[:8]}"
            t0 = time.perf_counter()

            try:
                mod = i % 10
                if mod < 4:
                    # 40% Consensus Writes
                    r.set(key, val)
                    results.append(1)
                elif mod < 8:
                    # 40% 0-Hop Leader Lease Reads
                    r.get(key)
                    results.append(1)
                elif mod == 8:
                    # 10% Atomic Counter
                    r.incr(f"py:counter:{worker_id}")
                    results.append(1)
                else:
                    # 10% Hashes
                    r.hset(f"py:hash:{worker_id}", f"field_{i % 5}", val)
                    results.append(1)

                lat = (time.perf_counter() - t0) * 1000.0  # ms
                latencies.append(lat)
            except Exception as e:
                errors.append(str(e))

    except Exception as e:
        errors.append(f"Worker {worker_id} connection failed: {e}")


def run_benchmark(host="127.0.0.1", port=6379, password=None, workers=8, ops_per_worker=250):
    total_ops = workers * ops_per_worker
    print("=" * 64)
    print("   RAFTLINE OFFICIAL REDIS-PY CLIENT BENCHMARK")
    print("=" * 64)
    print(f"  Target Cluster:    {host}:{port}")
    print(f"  Concurrency:       {workers} threads | {ops_per_worker} ops/worker")
    print(f"  Total Operations:  {total_ops}")
    print(f"  Driver:            redis-py v{redis.__version__}")
    print("-" * 64)

    results = []
    errors = []
    latencies = []

    start_time = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(worker_task, w, host, port, password, ops_per_worker, results, errors, latencies)
            for w in range(workers)
        ]
        for f in futures:
            f.result()

    duration = time.perf_counter() - start_time
    total = len(results) + len(errors)
    throughput = len(results) / max(0.001, duration)

    latencies.sort()
    p50 = latencies[int(len(latencies) * 0.50)] if latencies else 0.0
    p90 = latencies[int(len(latencies) * 0.90)] if latencies else 0.0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0.0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0.0

    print("=" * 64)
    print("   BENCHMARK SUMMARY")
    print("=" * 64)
    print(f"  Total Duration:    {duration:.3f} seconds")
    print(f"  Completed Ops:     {total}")
    print(f"  Successful Ops:    {len(results)} ({len(results)*100.0/max(1, total):.2f}%)")
    print(f"  Errors:            {len(errors)}")
    print(f"  Throughput:        {throughput:,.2f} ops/sec")
    print("-" * 64)
    print("  Client Latency (ms):")
    print(f"    P50:             {p50:.3f} ms")
    print(f"    P90:             {p90:.3f} ms")
    print(f"    P95:             {p95:.3f} ms")
    print(f"    P99:             {p99:.3f} ms")
    print("=" * 64)
    if errors:
        print(f"Sample error: {errors[0]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Raftline redis-py Benchmark Tool")
    parser.add_argument("--host", default="127.0.0.1", help="Target Redis host")
    parser.add_argument("--port", type=int, default=6379, help="Target Redis port")
    parser.add_argument("--auth", default=None, help="Authentication password")
    parser.add_argument("--workers", type=int, default=8, help="Number of concurrent client workers")
    parser.add_argument("--ops", type=int, default=250, help="Operations per worker")
    args = parser.parse_args()

    run_benchmark(args.host, args.port, args.auth, args.workers, args.ops)
