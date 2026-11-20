import { prisma } from "@nexus/database";
import { ensureTravelRecords } from "@/lib/travel/providers";
import { runTravelSyncWorker } from "@/lib/travel/travel-webhook-service";
import { createNotification } from "@/lib/social/shared";

const globalForTravel = globalThis as unknown as {
  nexusPayTravelWorkerStarted?: boolean;
  nexusPayTravelWorkerRunning?: boolean;
  nexusPayTravelConfigured?: boolean;
};

let configPromise: Promise<void> | null = null;

export function ensureTravelConfiguration(): Promise<void> {
  if (!configPromise) {
    configPromise = ensureTravelRecords().catch((error) => { configPromise = null; throw error; });
  }
  return configPromise;
}

async function expireSearches() {
  await prisma.travelSearch.updateMany({
    where: { status: { in: ["PENDING", "COMPLETED"] }, expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}

async function sendDepartureReminders() {
  const soon = new Date(Date.now() + 24 * 86_400_000);
  const items = await prisma.travelItineraryItem.findMany({
    where: { startAt: { gte: new Date(), lte: soon } },
    include: { trip: true }, take: 100,
  });
  for (const item of items) {
    const key = `travel-reminder-${item.id}-${item.startAt.toISOString()}`;
    const existing = await prisma.notification.findFirst({
      where: { userId: item.trip.userId, type: "TRAVEL_DEPARTURE_REMINDER", data: { path: ["dedupeKey"], equals: key } },
    });
    if (existing) continue;
    await createNotification(prisma, {
      userId: item.trip.userId,
      type: "TRAVEL_DEPARTURE_REMINDER",
      title: "Upcoming travel",
      body: `${item.title} starts soon. Times are shown in ${item.startTimeZone}.`,
      data: { itineraryItemId: item.id, tripId: item.tripId, dedupeKey: key },
    }).catch(() => undefined);
  }
}

export function startTravelWorker(intervalMs = 60_000): void {
  if (globalForTravel.nexusPayTravelWorkerStarted) return;
  globalForTravel.nexusPayTravelWorkerStarted = true;
  if (!globalForTravel.nexusPayTravelConfigured) {
    globalForTravel.nexusPayTravelConfigured = true;
    void ensureTravelConfiguration().catch(() => undefined);
  }
  setInterval(() => {
    if (globalForTravel.nexusPayTravelWorkerRunning) return;
    globalForTravel.nexusPayTravelWorkerRunning = true;
    Promise.all([runTravelSyncWorker(25), expireSearches(), sendDepartureReminders()])
      .catch(() => undefined)
      .finally(() => { globalForTravel.nexusPayTravelWorkerRunning = false; });
  }, intervalMs);
}
