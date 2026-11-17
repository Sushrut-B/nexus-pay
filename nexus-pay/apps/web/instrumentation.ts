export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/finance/schedule-worker");
    startScheduler();
  }
}
