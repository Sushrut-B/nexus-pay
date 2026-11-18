import { runFinanceWorker } from "@/lib/finance-intelligence/worker-service";

const globalForFinance = globalThis as unknown as {
  nexusPayFinanceWorkerStarted?: boolean;
  nexusPayFinanceWorkerRunning?: boolean;
};

/** Server-side financial intelligence worker. Started once per Node process. */
export function startFinanceWorker(intervalMs = 60_000): void {
  if (globalForFinance.nexusPayFinanceWorkerStarted) return;
  globalForFinance.nexusPayFinanceWorkerStarted = true;

  setInterval(() => {
    if (globalForFinance.nexusPayFinanceWorkerRunning) return;
    globalForFinance.nexusPayFinanceWorkerRunning = true;
    runFinanceWorker()
      .catch(() => undefined)
      .finally(() => {
        globalForFinance.nexusPayFinanceWorkerRunning = false;
      });
  }, intervalMs);
}
