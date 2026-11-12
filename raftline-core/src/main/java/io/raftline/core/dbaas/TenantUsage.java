package io.raftline.core.dbaas;

import java.util.concurrent.atomic.AtomicLong;

/**
 * Tracks real-time resource utilization, ops throughput, and quota violations for a tenant.
 */
public class TenantUsage {
    private final AtomicLong totalOps = new AtomicLong(0);
    private final AtomicLong totalBytes = new AtomicLong(0);
    private final AtomicLong keyCount = new AtomicLong(0);
    private final AtomicLong rateLimitViolations = new AtomicLong(0);
    private final AtomicLong quotaViolations = new AtomicLong(0);

    // Operational window rate calculation
    private volatile long lastWindowNanos = System.nanoTime();
    private final AtomicLong windowOps = new AtomicLong(0);
    private volatile double currentOpsPerSec = 0.0;

    public void recordOp(int bytes) {
        totalOps.incrementAndGet();
        if (bytes > 0) {
            totalBytes.addAndGet(bytes);
        }
        windowOps.incrementAndGet();
        refreshRate();
    }

    public void recordRateLimitViolation() {
        rateLimitViolations.incrementAndGet();
    }

    public void recordQuotaViolation() {
        quotaViolations.incrementAndGet();
    }

    public void setKeyCount(long count) {
        keyCount.set(count);
    }

    public long getKeyCount() {
        return keyCount.get();
    }

    public long getTotalOps() {
        return totalOps.get();
    }

    public long getTotalBytes() {
        return totalBytes.get();
    }

    public long getRateLimitViolations() {
        return rateLimitViolations.get();
    }

    public long getQuotaViolations() {
        return quotaViolations.get();
    }

    public double getCurrentOpsPerSec() {
        refreshRate();
        return currentOpsPerSec;
    }

    private synchronized void refreshRate() {
        long now = System.nanoTime();
        long elapsedNanos = now - lastWindowNanos;
        if (elapsedNanos >= 1_000_000_000L) { // 1 second window
            long ops = windowOps.getAndSet(0);
            currentOpsPerSec = ((double) ops * 1_000_000_000L) / elapsedNanos;
            lastWindowNanos = now;
        }
    }
}
