import { ApiError } from "@/lib/api/response";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    this.sweepIfNeeded();

    const current = this.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= current) {
      this.buckets.set(key, { count: 1, resetAt: current + windowMs });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - current) / 1000)),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds: 0,
    };
  }

  reset(): void {
    this.buckets.clear();
  }

  private sweepIfNeeded(): void {
    const current = this.now();
    if (current - this.lastSweep < 60_000) return;
    this.lastSweep = current;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= current) this.buckets.delete(key);
    }
  }
}

export const rateLimiter = new FixedWindowRateLimiter();

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  return rateLimiter.consume(key, limit, windowMs);
}

export function enforceRateLimitOrThrow(
  key: string,
  limit: number,
  windowMs: number,
  message = "Too many attempts. Please wait and try again.",
): void {
  const result = enforceRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw new ApiError(429, "AUTHORIZATION_ERROR", message, undefined, {
      "Retry-After": String(result.retryAfterSeconds),
    });
  }
}
