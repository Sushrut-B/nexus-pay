/**
 * Release 18 — durable global-finance worker.
 *
 * Mirrors the claim/lease/backoff/dead-letter pattern from investment & travel
 * workers. Browser timers are never used for financial processing. Uncertain
 * EXTERNAL financial operations are never blindly retried: only read-only rate
 * retrieval and local maintenance jobs are processed here.
 */
import { prisma } from "@nexus/database";
import { getServerEnv } from "@/lib/env";
import { syncLatestRate, syncHistoricalRates, ensureFxProviderRecords } from "@/lib/global/fx-service";
import { evaluateAlerts } from "@/lib/global/watchlist-service";
import { captureBalanceSnapshots } from "@/lib/global/global-accounts-service";
import { expireQuotes } from "@/lib/global/fx-quote-service";
import { notifyGlobal, recordGlobalAudit, publishGlobalSecurity } from "@/lib/global/global-audit";

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const READ_ONLY_KINDS = new Set([
  "RATE_SYNC", "HISTORICAL_RATE_SYNC", "VALUATION_SNAPSHOT", "ALERT_EVALUATION",
  "FX_QUOTE_EXPIRY", "WEBHOOK_PROCESSING",
]);

export async function enqueueGlobalJob(input: {
  kind: string; payload?: object; providerCode?: string; idempotencyKey?: string;
}) {
  if (!READ_ONLY_KINDS.has(input.kind)) {
    throw new Error(`Job kind '${input.kind}' is not a read-only global job and cannot be enqueued here`);
  }
  const data = {
    kind: input.kind,
    payload: input.payload ?? {},
    providerCode: input.providerCode ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    status: "PENDING",
    nextAttemptAt: new Date(),
  };
  if (input.idempotencyKey) {
    return prisma.fxSyncJob.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: data,
      update: {},
    });
  }
  return prisma.fxSyncJob.create({ data });
}

async function handle(job: {
  id: string; kind: string; payload: unknown; providerCode: string | null;
}) {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  switch (job.kind) {
    case "RATE_SYNC":
      await ensureFxProviderRecords();
      return syncLatestRate(String(payload.base ?? "USD"), String(payload.quote ?? "INR"), job.providerCode ?? "sandbox-fx");
    case "HISTORICAL_RATE_SYNC":
      await ensureFxProviderRecords();
      return syncHistoricalRates(
        String(payload.base ?? "USD"), String(payload.quote ?? "INR"),
        new Date(String(payload.from ?? new Date(Date.now() - 30 * 86400000).toISOString())),
        new Date(String(payload.to ?? new Date().toISOString())),
        job.providerCode ?? "sandbox-fx",
      );
    case "VALUATION_SNAPSHOT":
      return captureBalanceSnapshots();
    case "ALERT_EVALUATION":
      return evaluateAlerts();
    case "FX_QUOTE_EXPIRY":
      return expireQuotes();
    case "WEBHOOK_PROCESSING": {
      const result = await prisma.internationalPaymentWebhook.updateMany({
        where: { processed: false, signatureVerified: true }, data: { processed: true },
      });
      return result.count;
    }
    default:
      throw new Error(`Unsupported read-only job kind: ${job.kind}`);
  }
}

/** Returns one of: processed | skipped | failed. */
export async function processGlobalJob(jobId: string): Promise<"processed" | "skipped" | "failed"> {
  const job = await prisma.fxSyncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "PENDING") return "skipped";
  const now = new Date();
  if (job.nextAttemptAt && job.nextAttemptAt > now) return "skipped";

  const claimed = await prisma.fxSyncJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      leaseUntil: new Date(Date.now() + LEASE_MS),
    },
  });
  if (!claimed.count) return "skipped";

  try {
    await handle({ id: job.id, kind: job.kind, payload: job.payload, providerCode: job.providerCode });
    await prisma.fxSyncJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", leaseUntil: null, nextAttemptAt: null, lastError: null },
    });
    return "processed";
  } catch (error) {
    const attempts = job.attempts + 1;
    const dead = attempts >= Math.min(job.maxAttempts, MAX_ATTEMPTS);
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.fxSyncJob.update({
      where: { id: job.id },
      data: {
        status: dead ? "FAILED" : "PENDING",
        leaseUntil: null,
        lastError: message.slice(0, 900),
        nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * attempts),
      },
    });
    await recordGlobalAudit({ actorType: "WORKER", actorId: "global-worker", action: dead ? "GLOBAL_JOB_DEAD_LETTERED" : "GLOBAL_JOB_RETRY_SCHEDULED", targetType: "FX_SYNC_JOB", targetId: job.id, metadata: { kind: job.kind, attempts, error: message } });
    if (dead) {
      await publishGlobalSecurity({ type: "GLOBAL_RATE_SYNC_FAILED", metadata: { jobId: job.id, kind: job.kind, error: message } });
    }
    return "failed";
  }
}

export async function runGlobalWorker(limit = 25) {
  // Recover leases left by a worker that restarted mid-job.
  await prisma.fxSyncJob.updateMany({
    where: { status: "PROCESSING", leaseUntil: { lt: new Date() } },
    data: { status: "PENDING", leaseUntil: null, nextAttemptAt: new Date() },
  });
  const jobs = await prisma.fxSyncJob.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let processed = 0;
  for (const job of jobs) {
    if (await processGlobalJob(job.id) === "processed") processed += 1;
  }
  return { processed, total: jobs.length };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startGlobalWorker() {
  if (!getServerEnv().NEXUS_GLOBAL_ENABLED) return;
  if (timer) return;
  timer = setInterval(() => {
    runGlobalWorker().catch((error) => {
      recordGlobalAudit({
        actorType: "WORKER", actorId: "global-worker", action: "GLOBAL_WORKER_TICK_FAILED",
        targetType: "FX_SYNC_JOB", targetId: "system",
        metadata: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    });
  }, 60_000);
  timer.unref?.();
  return timer;
}

export { notifyGlobal };
