import { prisma } from "@nexus/database";
import { DEFAULT_ACTION_MAP, DEFAULT_POLICY_CODE, DEFAULT_THRESHOLDS, RULESET_VERSION } from "@/lib/fraud/config";
import { seedRules } from "@/lib/fraud/rules";
import { ensureBaselineModel } from "@/lib/fraud/model-service";
import { runSecurityEventWorker } from "@/lib/fraud/event-worker";
import { countRecentEvents } from "@/lib/fraud/event-service";
import { evaluateRisk } from "@/lib/fraud/risk-engine";

const globalForFraud = globalThis as unknown as {
  nexusPayFraudWorkerStarted?: boolean;
  nexusPayFraudWorkerRunning?: boolean;
  nexusPayFraudConfigured?: boolean;
};

let configurationPromise: Promise<void> | null = null;

export function ensureFraudConfiguration(): Promise<void> {
  if (!configurationPromise) {
    configurationPromise = (async () => {
      await prisma.riskPolicy.upsert({
        where: { code: DEFAULT_POLICY_CODE },
        create: {
          code: DEFAULT_POLICY_CODE,
          name: "Default risk policy",
          thresholds: DEFAULT_THRESHOLDS,
          actionMap: DEFAULT_ACTION_MAP,
          fallbackAction: "REQUIRE_CUSTOMER_CONFIRMATION",
          enabled: true,
          version: 1,
          updatedBy: "system",
        },
        update: {},
      });
      await seedRules("system");
      await ensureBaselineModel("system");
    })().catch((error) => {
      configurationPromise = null;
      throw error;
    });
  }
  return configurationPromise;
}

async function runPeriodicReassessment(limit = 25) {
  const recent = await prisma.securityEvent.findMany({
    where: { actorId: { not: null }, occurredAt: { gte: new Date(Date.now() - 86_400_000) } },
    select: { actorId: true },
    distinct: ["actorId"],
    take: limit,
  });
  for (const row of recent) {
    if (!row.actorId) continue;
    const since = new Date(Date.now() - 3600_000);
    const [failedLogins, resets, newDevices] = await Promise.all([
      countRecentEvents({ type: "LOGIN_FAILURE", actorId: row.actorId, since }),
      countRecentEvents({ type: "PASSWORD_RESET_COMPLETED", actorId: row.actorId, since }),
      countRecentEvents({ type: "NEW_DEVICE_LOGIN", actorId: row.actorId, since }),
    ]);
    if (failedLogins === 0 && resets === 0 && newDevices === 0) continue;
    await evaluateRisk({
      mode: "PERIODIC",
      subjectType: "USER",
      subjectId: row.actorId,
      userId: row.actorId,
      context: {
        failedLoginCount: failedLogins,
        passwordResetCount: resets,
        newDevice: newDevices > 0,
        recoveryRecent: resets > 0,
        sourceModule: "security",
      },
    });
  }
}

export function startFraudWorker(intervalMs = 60_000): void {
  if (globalForFraud.nexusPayFraudWorkerStarted) return;
  globalForFraud.nexusPayFraudWorkerStarted = true;
  if (!globalForFraud.nexusPayFraudConfigured) {
    globalForFraud.nexusPayFraudConfigured = true;
    void ensureFraudConfiguration().catch(() => undefined);
  }
  setInterval(() => {
    if (globalForFraud.nexusPayFraudWorkerRunning) return;
    globalForFraud.nexusPayFraudWorkerRunning = true;
    Promise.all([runSecurityEventWorker(100), runPeriodicReassessment()])
      .catch(() => undefined)
      .finally(() => { globalForFraud.nexusPayFraudWorkerRunning = false; });
  }, intervalMs);
}

export { RULESET_VERSION };
