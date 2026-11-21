/** Release 20 — durable security worker (claim/lease/backoff/dead-letter). */
import { prisma } from "@nexus/database";
import { getServerEnv } from "@/lib/env";
import { generateExport } from "@/lib/identity/privacy-service";

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const ALLOWED_KINDS = new Set([
  "EXPORT_GENERATE", "SECURITY_CLEANUP", "SECURITY_ANALYTICS_SNAPSHOT",
]);

export async function enqueueSecurityJob(input: {
  kind: string; payload?: object; idempotencyKey?: string;
}) {
  if (!ALLOWED_KINDS.has(input.kind)) {
    throw new Error(`Job kind '${input.kind}' is not an allowed security job`);
  }
  const data = {
    kind: input.kind,
    payload: input.payload ?? {},
    status: "PENDING",
    nextAttemptAt: new Date(),
    idempotencyKey: input.idempotencyKey ?? null,
  };
  if (input.idempotencyKey) {
    return prisma.securityJob.upsert({
      where: { idempotencyKey: input.idempotencyKey }, create: data, update: {},
    });
  }
  return prisma.securityJob.create({ data });
}

async function handle(kind: string, payload: unknown) {
  const data = (payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "EXPORT_GENERATE":
      return generateExport(String(data.exportId ?? ""));
    case "SECURITY_CLEANUP": {
      const now = new Date();
      const [challenges, grants, recoveries, exports] = await Promise.all([
        prisma.mfaChallenge.deleteMany({ where: { expiresAt: { lt: now }, consumedAt: { not: null } } }),
        prisma.stepUpGrant.deleteMany({ where: { expiresAt: { lt: now }, consumedAt: { not: null } } }),
        prisma.accountRecoveryRequest.updateMany({
          where: { status: "REQUESTED", expiresAt: { lt: now } }, data: { status: "EXPIRED" },
        }),
        prisma.dataExportRequest.updateMany({
          where: { status: "READY", expiresAt: { lt: now } }, data: { status: "EXPIRED" },
        }),
      ]);
      return challenges.count + grants.count + recoveries.count + exports.count;
    }
    case "SECURITY_ANALYTICS_SNAPSHOT": {
      const [events, incidents, jobs] = await Promise.all([
        prisma.securityEvent.count(),
        prisma.securityIncident.count({ where: { status: "OPEN" } }),
        prisma.securityJob.count({ where: { status: "FAILED" } }),
      ]);
      await prisma.adminSecurityAction.create({
        data: {
          actorId: "system", action: "SECURITY_ANALYTICS_SNAPSHOT",
          targetType: "SECURITY_OPERATIONS", targetId: "snapshot",
          reason: "Automated operational snapshot",
          metadata: { events, openIncidents: incidents, failedJobs: jobs },
        },
      });
      return events;
    }
    default:
      throw new Error(`Unsupported security job kind: ${kind}`);
  }
}

export async function processSecurityJob(jobId: string): Promise<"processed" | "skipped" | "failed"> {
  const job = await prisma.securityJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "PENDING") return "skipped";
  if (job.nextAttemptAt && job.nextAttemptAt > new Date()) return "skipped";
  const claimed = await prisma.securityJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (!claimed.count) return "skipped";
  try {
    await handle(job.kind, job.payload);
    await prisma.securityJob.update({
      where: { id: jobId }, data: { status: "COMPLETED", leaseUntil: null, nextAttemptAt: null, lastError: null },
    });
    return "processed";
  } catch (error) {
    const attempts = job.attempts + 1;
    const dead = attempts >= Math.min(job.maxAttempts, MAX_ATTEMPTS);
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.securityJob.update({
      where: { id: jobId },
      data: {
        status: dead ? "FAILED" : "PENDING", leaseUntil: null,
        lastError: message.slice(0, 900),
        nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * attempts),
      },
    });
    await prisma.adminSecurityAction.create({
      data: {
        actorId: "system",
        action: dead ? "SECURITY_JOB_DEAD_LETTERED" : "SECURITY_JOB_RETRY_SCHEDULED",
        targetType: "SECURITY_JOB", targetId: jobId,
        reason: "Automated security job failure handling",
        metadata: { kind: job.kind, attempts, error: message },
      },
    });
    return "failed";
  }
}

export async function runSecurityJobsWorker(limit = 25) {
  await prisma.securityJob.updateMany({
    where: { status: "PROCESSING", leaseUntil: { lt: new Date() } },
    data: { status: "PENDING", leaseUntil: null, nextAttemptAt: new Date() },
  });
  const jobs = await prisma.securityJob.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of jobs) if (await processSecurityJob(job.id) === "processed") processed += 1;
  return { processed, total: jobs.length };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSecurityWorker() {
  if (!getServerEnv().NEXUS_SECURITY_ENABLED) return;
  if (timer) return;
  timer = setInterval(() => {
    runSecurityJobsWorker().catch(() => undefined);
  }, 60_000);
  timer.unref?.();
  return timer;
}
