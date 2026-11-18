import { runRewardsWorker } from "@/lib/rewards/rewards-worker";

const globalForRewards = globalThis as unknown as {
  nexusPayRewardsWorkerStarted?: boolean;
  nexusPayRewardsWorkerRunning?: boolean;
};

/** Server-side rewards worker. Started once per Node process. */
export function startRewardsWorker(intervalMs = 30_000): void {
  if (globalForRewards.nexusPayRewardsWorkerStarted) return;
  globalForRewards.nexusPayRewardsWorkerStarted = true;

  setInterval(() => {
    if (globalForRewards.nexusPayRewardsWorkerRunning) return;
    globalForRewards.nexusPayRewardsWorkerRunning = true;
    runRewardsWorker()
      .catch(() => undefined)
      .finally(() => {
        globalForRewards.nexusPayRewardsWorkerRunning = false;
      });
  }, intervalMs);
}
