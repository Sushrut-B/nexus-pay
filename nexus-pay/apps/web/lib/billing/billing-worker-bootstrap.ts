import { prisma } from "@nexus/database";
import { ensureBillerRecords } from "@/lib/billing/providers";
import { syncBillerCatalogue } from "@/lib/billing/catalog-service";
import { runBillSyncWorker } from "@/lib/billing/billing-webhook-service";
import { runReminderWorker, detectRecurringBills } from "@/lib/billing/recurring-service";

const globalForBilling = globalThis as unknown as {
  nexusPayBillingWorkerStarted?: boolean;
  nexusPayBillingWorkerRunning?: boolean;
  nexusPayBillingConfigured?: boolean;
};

let configPromise: Promise<void> | null = null;

export function ensureBillingConfiguration(): Promise<void> {
  if (!configPromise) {
    configPromise = (async () => {
      await ensureBillerRecords();
      await syncBillerCatalogue();
    })().catch((error) => { configPromise = null; throw error; });
  }
  return configPromise;
}

async function runRecurringDetection() {
  const users = await prisma.billPaymentIntent.findMany({
    where: { status: "BILLER_CONFIRMED" }, select: { userId: true }, distinct: ["userId"], take: 25,
  });
  for (const row of users) await detectRecurringBills(row.userId);
}

export function startBillPaymentWorker(intervalMs = 60_000): void {
  if (globalForBilling.nexusPayBillingWorkerStarted) return;
  globalForBilling.nexusPayBillingWorkerStarted = true;
  if (!globalForBilling.nexusPayBillingConfigured) {
    globalForBilling.nexusPayBillingConfigured = true;
    void ensureBillingConfiguration().catch(() => undefined);
  }
  setInterval(() => {
    if (globalForBilling.nexusPayBillingWorkerRunning) return;
    globalForBilling.nexusPayBillingWorkerRunning = true;
    Promise.all([
      runBillSyncWorker(25),
      runReminderWorker(50),
      syncBillerCatalogue(),
      runRecurringDetection(),
    ]).catch(() => undefined).finally(() => { globalForBilling.nexusPayBillingWorkerRunning = false; });
  }, intervalMs);
}
