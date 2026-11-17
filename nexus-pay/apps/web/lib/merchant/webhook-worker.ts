import { runWebhookWorker } from "@/lib/merchant/webhook-service";

const globalForWebhooks = globalThis as unknown as {
  nexusPayWebhookWorkerStarted?: boolean;
  nexusPayWebhookWorkerRunning?: boolean;
};

/** Background webhook outbox delivery. Never called from settlement paths. */
export function startWebhookWorker(intervalMs = 20_000): void {
  if (globalForWebhooks.nexusPayWebhookWorkerStarted) return;
  globalForWebhooks.nexusPayWebhookWorkerStarted = true;

  setInterval(() => {
    if (globalForWebhooks.nexusPayWebhookWorkerRunning) return;
    globalForWebhooks.nexusPayWebhookWorkerRunning = true;
    runWebhookWorker(25)
      .catch(() => undefined)
      .finally(() => {
        globalForWebhooks.nexusPayWebhookWorkerRunning = false;
      });
  }, intervalMs);
}
