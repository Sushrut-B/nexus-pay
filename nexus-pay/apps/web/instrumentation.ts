export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/finance/schedule-worker");
    const { startWebhookWorker } = await import("@/lib/merchant/webhook-worker");
    startScheduler();
    startWebhookWorker();
  }
}
