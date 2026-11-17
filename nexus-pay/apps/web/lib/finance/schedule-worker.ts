import { runDueExecutions } from "@/lib/finance/schedule-engine";

const globalForScheduler = globalThis as unknown as {
  nexusPaySchedulerStarted?: boolean;
  nexusPaySchedulerRunning?: boolean;
};

/**
 * Server-side scheduler. Started once per Node process from
 * instrumentation.ts; also runnable standalone via scripts/run-scheduler.ts.
 * A module-level guard prevents overlapping runs within a process, and the
 * execution claim in the engine prevents concurrent workers from duplicating
 * a payment.
 */
export function startScheduler(intervalMs = 30_000): void {
  if (globalForScheduler.nexusPaySchedulerStarted) return;
  globalForScheduler.nexusPaySchedulerStarted = true;

  setInterval(() => {
    if (globalForScheduler.nexusPaySchedulerRunning) return;
    globalForScheduler.nexusPaySchedulerRunning = true;
    runDueExecutions()
      .catch(() => undefined)
      .finally(() => {
        globalForScheduler.nexusPaySchedulerRunning = false;
      });
  }, intervalMs);
}
