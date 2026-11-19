import { runProviderSyncWorker } from "@/lib/insurance/webhook-service";
import { syncCatalog } from "@/lib/insurance/catalog-service";
import { expireQuotes } from "@/lib/insurance/quote-service";

const globalForInsurance = globalThis as unknown as {
  nexusPayInsuranceWorkerStarted?: boolean;
  nexusPayInsuranceWorkerRunning?: boolean;
  nexusPayInsuranceCatalogSynced?: boolean;
};

export function startInsuranceWorker(intervalMs = 60_000): void {
  if (globalForInsurance.nexusPayInsuranceWorkerStarted) return;
  globalForInsurance.nexusPayInsuranceWorkerStarted = true;
  if (!globalForInsurance.nexusPayInsuranceCatalogSynced) {
    globalForInsurance.nexusPayInsuranceCatalogSynced = true;
    syncCatalog().catch(() => undefined);
  }
  setInterval(() => {
    if (globalForInsurance.nexusPayInsuranceWorkerRunning) return;
    globalForInsurance.nexusPayInsuranceWorkerRunning = true;
    Promise.all([runProviderSyncWorker(25), syncCatalog(), expireQuotes()])
      .catch(() => undefined)
      .finally(() => {
        globalForInsurance.nexusPayInsuranceWorkerRunning = false;
      });
  }, intervalMs);
}
