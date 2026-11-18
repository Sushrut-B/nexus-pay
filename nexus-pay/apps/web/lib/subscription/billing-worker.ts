import { runBillingWorker } from "@/lib/subscription/billing-engine";

const globalForBilling = globalThis as unknown as {
  nexusPayBillingWorkerStarted?: boolean;
  nexusPayBillingWorkerRunning?: boolean;
};

/** Server-side recurring billing worker. Started once per Node process. */
export function startBillingWorker(intervalMs = 30_000): void {
  if (globalForBilling.nexusPayBillingWorkerStarted) return;
  globalForBilling.nexusPayBillingWorkerStarted = true;

  setInterval(() => {
    if (globalForBilling.nexusPayBillingWorkerRunning) return;
    globalForBilling.nexusPayBillingWorkerRunning = true;
    runBillingWorker(25)
      .catch(() => undefined)
      .finally(() => {
        globalForBilling.nexusPayBillingWorkerRunning = false;
      });
  }, intervalMs);
}
