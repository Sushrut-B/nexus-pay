export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/finance/schedule-worker");
    const { startWebhookWorker } = await import("@/lib/merchant/webhook-worker");
    const { startBillingWorker } = await import("@/lib/subscription/billing-worker");
    const { startRewardsWorker } = await import("@/lib/rewards/rewards-worker-bootstrap");
    const { startFinanceWorker } = await import("@/lib/finance-intelligence/finance-worker-bootstrap");
    const { startAccountsWorker } = await import("@/lib/accounts/accounts-worker-bootstrap");
    const { startCreditWorker } = await import("@/lib/credit/credit-worker-bootstrap");
    startScheduler();
    startWebhookWorker();
    startBillingWorker();
    startRewardsWorker();
    startFinanceWorker();
    startAccountsWorker();
    startCreditWorker();
  }
}
