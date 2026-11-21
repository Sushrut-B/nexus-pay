/**
 * Release 19 — durable support worker. Claim/lease/backoff/dead-letter mirrors
 * existing durable workers. No browser timers. No external financial mutation.
 */
import { prisma } from "@nexus/database";
import { getServerEnv } from "@/lib/env";
import { notifySupport, recordSupportAudit, publishSupportSecurity } from "@/lib/support/support-audit";
import { refreshLinkedOperation } from "@/lib/support/case-service";
import { articlesNeedingReview } from "@/lib/support/help-service";
import { getSupportOperations } from "@/lib/support/support-operations";

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const ALLOWED_KINDS = new Set([
  "INACTIVITY_REMINDER", "PROVIDER_STATUS_SYNC", "ESCALATION_EVALUATION",
  "HELP_REVIEW_REMINDER", "ANALYTICS_AGGREGATION",
]);

export async function enqueueSupportJob(input: {
  kind: string; payload?: object; idempotencyKey?: string;
}) {
  if (!ALLOWED_KINDS.has(input.kind)) {
    throw new Error(`Job kind '${input.kind}' is not an allowed support job`);
  }
  const data = {
    kind: input.kind,
    payload: input.payload ?? {},
    status: "PENDING",
    nextAttemptAt: new Date(),
    idempotencyKey: input.idempotencyKey ?? null,
  };
  if (input.idempotencyKey) {
    return prisma.supportJob.upsert({ where: { idempotencyKey: input.idempotencyKey }, create: data, update: {} });
  }
  return prisma.supportJob.create({ data });
}

async function handle(kind: string) {
  const env = getServerEnv();
  switch (kind) {
    case "INACTIVITY_REMINDER": {
      const cutoff = new Date(Date.now() - env.NEXUS_SUPPORT_INACTIVITY_REMINDER_HOURS * 3600_000);
      const cases = await prisma.supportCase.findMany({
        where: { lastActivityAt: { lt: cutoff }, status: { in: ["OPEN", "TRIAGED", "WAITING_FOR_USER", "IN_PROGRESS"] } },
        take: 100,
      });
      let sent = 0;
      for (const row of cases) {
        const bucket = cutoff.toISOString().slice(0, 13);
        const notified = await notifySupport({
          userId: row.userId,
          eventKey: `support:inactivity:${row.id}:${bucket}`,
          type: "SUPPORT_CASE_STATUS_CHANGED",
          title: `Case ${row.reference} is awaiting action`,
          body: "Your support case has had no recent activity. This is an operational reminder, not a resolution promise.",
          caseId: row.id, preference: "caseUpdates", data: { caseId: row.id },
        });
        if (notified) sent += 1;
      }
      return sent;
    }
    case "PROVIDER_STATUS_SYNC": {
      const cases = await prisma.supportCase.findMany({
        where: { status: "WAITING_FOR_PROVIDER" }, take: 50,
      });
      let refreshed = 0;
      for (const row of cases) {
        refreshed += await refreshLinkedOperation("support-worker", row.id);
      }
      return refreshed;
    }
    case "ESCALATION_EVALUATION": {
      // Internal operational review threshold only — not a customer SLA.
      const cutoff = new Date(Date.now() - env.NEXUS_SUPPORT_INACTIVITY_REMINDER_HOURS * 2 * 3600_000);
      const cases = await prisma.supportCase.findMany({
        where: {
          status: { in: ["WAITING_FOR_PROVIDER", "IN_PROGRESS", "TRIAGED"] },
          lastActivityAt: { lt: cutoff },
        },
        take: 50,
      });
      let flagged = 0;
      for (const row of cases) {
        const already = await prisma.supportEscalation.findFirst({
          where: { caseId: row.id, resolvedAt: null },
        });
        if (already) continue;
        await prisma.supportEscalation.create({
          data: {
            caseId: row.id,
            reason: "Internal review threshold exceeded. No customer resolution time was promised.",
            signal: "VERIFIED_SERVICE_TARGET_EXCEEDED",
            escalatedBy: "support-worker",
          },
        });
        await prisma.supportCase.update({ where: { id: row.id }, data: { status: "ESCALATED", priority: "HIGH" } });
        await publishSupportSecurity({ type: "SUPPORT_CASE_ESCALATED", metadata: { caseId: row.id, source: "worker" } });
        flagged += 1;
      }
      return flagged;
    }
    case "HELP_REVIEW_REMINDER": {
      const articles = await articlesNeedingReview();
      if (articles.length) {
        await recordSupportAudit({
          actorType: "WORKER", actorId: "support-worker", action: "HELP_REVIEW_REQUIRED",
          targetType: "HELP_ARTICLE", targetId: "bulk",
          metadata: { count: articles.length, slugs: articles.map((a) => a.slug) },
        });
      }
      return articles.length;
    }
    case "ANALYTICS_AGGREGATION": {
      const metrics = await getSupportOperations({ limit: 1 });
      await recordSupportAudit({
        actorType: "WORKER", actorId: "support-worker", action: "SUPPORT_ANALYTICS_SNAPSHOT",
        targetType: "SUPPORT_OPERATIONS", targetId: "snapshot",
        metadata: {
          total: metrics.total, open: metrics.open, awaitingUser: metrics.awaitingUser,
          awaitingProvider: metrics.awaitingProvider, resolved: metrics.resolved,
        },
      });
      return metrics.total;
    }
    default:
      throw new Error(`Unsupported support job kind: ${kind}`);
  }
}

export async function processSupportJob(jobId: string): Promise<"processed" | "skipped" | "failed"> {
  const job = await prisma.supportJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "PENDING") return "skipped";
  if (job.nextAttemptAt && job.nextAttemptAt > new Date()) return "skipped";

  const claimed = await prisma.supportJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (!claimed.count) return "skipped";

  try {
    await handle(job.kind);
    await prisma.supportJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", leaseUntil: null, nextAttemptAt: null, lastError: null },
    });
    return "processed";
  } catch (error) {
    const attempts = job.attempts + 1;
    const dead = attempts >= Math.min(job.maxAttempts, MAX_ATTEMPTS);
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.supportJob.update({
      where: { id: jobId },
      data: {
        status: dead ? "FAILED" : "PENDING",
        leaseUntil: null,
        lastError: message.slice(0, 900),
        nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * attempts),
      },
    });
    await recordSupportAudit({
      actorType: "WORKER", actorId: "support-worker",
      action: dead ? "SUPPORT_JOB_DEAD_LETTERED" : "SUPPORT_JOB_RETRY_SCHEDULED",
      targetType: "SUPPORT_JOB", targetId: jobId,
      metadata: { kind: job.kind, attempts, error: message },
    });
    return "failed";
  }
}

export async function runSupportWorker(limit = 25) {
  await prisma.supportJob.updateMany({
    where: { status: "PROCESSING", leaseUntil: { lt: new Date() } },
    data: { status: "PENDING", leaseUntil: null, nextAttemptAt: new Date() },
  });
  const jobs = await prisma.supportJob.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of jobs) if (await processSupportJob(job.id) === "processed") processed += 1;
  return { processed, total: jobs.length };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSupportWorker() {
  if (!getServerEnv().NEXUS_SUPPORT_ENABLED) return;
  if (timer) return;
  timer = setInterval(() => {
    runSupportWorker().catch((error) => {
      recordSupportAudit({
        actorType: "WORKER", actorId: "support-worker", action: "SUPPORT_WORKER_TICK_FAILED",
        targetType: "SUPPORT_JOB", targetId: "system",
        metadata: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    });
  }, 60_000);
  timer.unref?.();
  return timer;
}
