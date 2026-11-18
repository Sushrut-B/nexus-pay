import { runProviderSyncWorker } from "@/lib/credit/webhook-service";
import { syncCatalog } from "@/lib/credit/catalog-service";

const globalForCredit = globalThis as unknown as {
  nexusPayCreditWorkerStarted?: boolean;
  nexusPayCreditWorkerRunning?: boolean;
  nexusPayCreditCatalogSynced?: boolean;
};

/** Server-side lender-provider sync worker. Started once per Node process. */
export function startCreditWorker(intervalMs = 60_000): void {
  if (globalForCredit.nexusPayCreditWorkerStarted) return;
  globalForCredit.nexusPayCreditWorkerStarted = true;

  if (!globalForCredit.nexusPayCreditCatalogSynced) {
    globalForCredit.nexusPayCreditCatalogSynced = true;
    syncCatalog().catch(() => undefined);
  }

  setInterval(() => {
    if (globalForCredit.nexusPayCreditWorkerRunning) return;
    globalForCredit.nexusPayCreditWorkerRunning = true;
    Promise.all([runProviderSyncWorker(25), syncCatalog()])
      .catch(() => undefined)
      .finally(() => {
        globalForCredit.nexusPayCreditWorkerRunning = false;
      });
  }, intervalMs);
}
