import { runSyncWorker } from "@/lib/accounts/sync-service";

const globalForAccounts = globalThis as unknown as {
  nexusPayAccountsWorkerStarted?: boolean;
  nexusPayAccountsWorkerRunning?: boolean;
};

/** Server-side external-account synchronisation worker. */
export function startAccountsWorker(intervalMs = 30_000): void {
  if (globalForAccounts.nexusPayAccountsWorkerStarted) return;
  globalForAccounts.nexusPayAccountsWorkerStarted = true;

  setInterval(() => {
    if (globalForAccounts.nexusPayAccountsWorkerRunning) return;
    globalForAccounts.nexusPayAccountsWorkerRunning = true;
    runSyncWorker(25)
      .catch(() => undefined)
      .finally(() => {
        globalForAccounts.nexusPayAccountsWorkerRunning = false;
      });
  }, intervalMs);
}
