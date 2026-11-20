import { seedTaxRuleSets } from "@/lib/tax/tax-rules";
import { runTaxWorker, sendDeadlineReminders, seedDeadlines } from "@/lib/tax/tax-worker-service";

const globalForTax = globalThis as unknown as {
  nexusPayTaxWorkerStarted?: boolean;
  nexusPayTaxWorkerRunning?: boolean;
  nexusPayTaxConfigured?: boolean;
};

let configPromise: Promise<void> | null = null;

export function ensureTaxConfiguration(): Promise<void> {
  if (!configPromise) {
    configPromise = (async () => {
      await seedTaxRuleSets();
      await seedDeadlines();
    })().catch((error) => { configPromise = null; throw error; });
  }
  return configPromise;
}

export function startTaxWorker(intervalMs = 60_000): void {
  if (globalForTax.nexusPayTaxWorkerStarted) return;
  globalForTax.nexusPayTaxWorkerStarted = true;
  if (!globalForTax.nexusPayTaxConfigured) {
    globalForTax.nexusPayTaxConfigured = true;
    void ensureTaxConfiguration().catch(() => undefined);
  }
  setInterval(() => {
    if (globalForTax.nexusPayTaxWorkerRunning) return;
    globalForTax.nexusPayTaxWorkerRunning = true;
    Promise.all([runTaxWorker(25), sendDeadlineReminders()])
      .catch(() => undefined)
      .finally(() => { globalForTax.nexusPayTaxWorkerRunning = false; });
  }, intervalMs);
}
