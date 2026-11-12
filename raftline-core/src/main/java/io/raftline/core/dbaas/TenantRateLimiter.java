package io.raftline.core.dbaas;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Token-bucket rate limiter enforcing tenant-level operations per second limits.
 */
public class TenantRateLimiter {
    private final int maxOpsPerSec;
    private final double refillTokensPerNano;
    private final double maxTokens;

    private double availableTokens;
    private long lastRefillNanos;

    public TenantRateLimiter(int maxOpsPerSec) {
        this.maxOpsPerSec = Math.max(1, maxOpsPerSec);
        // Allow bursts up to maxOpsPerSec
        this.maxTokens = this.maxOpsPerSec;
        this.availableTokens = this.maxTokens;
        this.refillTokensPerNano = (double) this.maxOpsPerSec / TimeUnit.SECONDS.toNanos(1);
        this.lastRefillNanos = System.nanoTime();
    }

    public synchronized boolean tryAcquire() {
        refill();
        if (availableTokens >= 1.0) {
            availableTokens -= 1.0;
            return true;
        }
        return false;
    }

    private void refill() {
        long now = System.nanoTime();
        long elapsedNanos = now - lastRefillNanos;
        if (elapsedNanos > 0) {
            double newTokens = elapsedNanos * refillTokensPerNano;
            this.availableTokens = Math.min(maxTokens, availableTokens + newTokens);
            this.lastRefillNanos = now;
        }
    }

    public int getMaxOpsPerSec() {
        return maxOpsPerSec;
    }

    public synchronized double getAvailableTokens() {
        refill();
        return availableTokens;
    }
}
