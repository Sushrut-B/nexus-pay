import { prisma } from "@nexus/database";
import type { TravelTripView, TravelItineraryViewItem, TravelBudgetView, TravelExpenseView } from "@nexus/shared-types";
import type { TravelTripInput, TravelExpenseInput, TravelBudgetInput, TravelItineraryItemInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { formatLocalDateTime } from "@/lib/travel/itinerary";
import { securityAudit } from "@/lib/fraud/audit-service";

export function tripView(row: {
  id: string; name: string; destination: string | null; startDate: Date | null;
  endDate: Date | null; status: string; notes: string | null;
  _count?: { bookings?: number; itinerary?: number; expenses?: number };
}): TravelTripView {
  return {
    id: row.id, name: row.name, destination: row.destination,
    startDate: row.startDate?.toISOString() ?? null, endDate: row.endDate?.toISOString() ?? null,
    status: row.status, note: row.notes,
    bookingCount: row._count?.bookings ?? 0,
  };
}

async function load(userId: string, id: string) {
  const row = await prisma.travelTrip.findFirst({
    where: { id, userId },
    include: { _count: { select: { itinerary: true, expenses: true } } },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Trip not found.");
  return row;
}

export async function listTrips(userId: string) {
  const rows = await prisma.travelTrip.findMany({
    where: { userId, status: "ACTIVE" },
    include: { _count: { select: { itinerary: true } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map((row) => tripView({
    id: row.id, name: row.name, destination: row.destination,
    startDate: row.startDate, endDate: row.endDate, status: row.status,
    notes: row.notes, _count: { bookings: row._count.itinerary },
  }));
}

export async function createTrip(userId: string, input: TravelTripInput) {
  const row = await prisma.travelTrip.create({
    data: {
      userId, name: input.name, destination: input.destination ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      notes: input.notes ?? null,
      members: { create: { userId, role: "OWNER" } },
    },
  });
  await securityAudit({ actorType: "USER", actorId: userId, action: "TRAVEL_TRIP_CREATED", targetType: "travel_trip", targetId: row.id });
  return tripView(row);
}

export async function getTrip(userId: string, id: string) { return tripView(await load(userId, id)); }

export async function updateTrip(userId: string, id: string, input: Partial<TravelTripInput>) {
  await load(userId, id);
  const row = await prisma.travelTrip.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.destination !== undefined ? { destination: input.destination } : {}),
      ...(input.startDate ? { startDate: new Date(input.startDate) } : {}),
      ...(input.endDate ? { endDate: new Date(input.endDate) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
  return tripView(row);
}

export async function deleteTrip(userId: string, id: string) {
  await load(userId, id);
  await prisma.travelTrip.update({ where: { id }, data: { status: "INACTIVE" } });
  return { id, deleted: true };
}

export async function addBookingToTrip(userId: string, tripId: string, bookingId: string, input: {
  title: string; startAt: string; endAt?: string; startTimeZone?: string; endTimeZone?: string; location?: string;
}) {
  await load(userId, tripId);
  const booking = await prisma.travelBooking.findFirst({ where: { id: bookingId, userId } });
  if (!booking) throw new ApiError(404, "AUTHORIZATION_ERROR", "Booking not found.");
  const row = await prisma.travelItineraryItem.create({
    data: {
      tripId, bookingId, category: booking.category, title: input.title,
      startAt: new Date(input.startAt), endAt: input.endAt ? new Date(input.endAt) : null,
      startTimeZone: input.startTimeZone ?? "Asia/Kolkata",
      endTimeZone: input.endTimeZone ?? null,
      location: input.location ?? null,
    },
  });
  return itineraryView(row);
}

export async function addItineraryItem(userId: string, tripId: string, input: TravelItineraryItemInput) {
  await load(userId, tripId);
  const row = await prisma.travelItineraryItem.create({
    data: {
      tripId, bookingId: input.bookingId ?? null, category: input.category,
      title: input.title, startAt: new Date(input.startAt),
      endAt: input.endAt ? new Date(input.endAt) : null,
      startTimeZone: input.startTimeZone, endTimeZone: input.endTimeZone ?? null,
      location: input.location ?? null,
    },
  });
  return itineraryView(row);
}

function itineraryView(row: {
  id: string; bookingId: string | null; category: string; title: string;
  startAt: Date; endAt: Date | null; startTimeZone: string; location: string | null;
}): TravelItineraryViewItem {
  return {
    id: row.id, bookingId: row.bookingId, category: row.category as TravelItineraryViewItem["category"],
    title: row.title, startAt: row.startAt.toISOString(),
    endAt: row.endAt?.toISOString() ?? null, startTimeZone: row.startTimeZone,
    localStart: formatLocalDateTime(row.startAt.toISOString(), row.startTimeZone),
    location: row.location,
  };
}

export async function getItinerary(userId: string, tripId: string): Promise<TravelItineraryViewItem[]> {
  await load(userId, tripId);
  const rows = await prisma.travelItineraryItem.findMany({ where: { tripId }, orderBy: { startAt: "asc" } });
  return rows.map(itineraryView);
}

export async function setBudget(userId: string, tripId: string, input: TravelBudgetInput) {
  await load(userId, tripId);
  const row = await prisma.travelBudget.upsert({
    where: { tripId },
    create: { tripId, amountMinor: input.amountMinor, currency: input.currency, categories: input.categories },
    update: { amountMinor: input.amountMinor, currency: input.currency, categories: input.categories },
  });
  return budgetView(tripId, row.amountMinor, row.currency, row.categories as string[]);
}

async function budgetView(tripId: string, amountMinor: number, currency: string, categories: string[]): Promise<TravelBudgetView> {
  const expenses = await prisma.travelExpense.findMany({
    where: { tripId, status: { in: ["CONFIRMED", "PENDING"] } },
  });
  const spentMinor = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  return { amountMinor, currency, spentMinor, remainingMinor: amountMinor - spentMinor, categories };
}

export async function getBudget(userId: string, tripId: string): Promise<TravelBudgetView> {
  await load(userId, tripId);
  const row = await prisma.travelBudget.findUnique({ where: { tripId } });
  return budgetView(tripId, row?.amountMinor ?? 0, row?.currency ?? "INR", (row?.categories as string[] | null) ?? []);
}

export async function addExpense(userId: string, tripId: string, input: TravelExpenseInput) {
  await load(userId, tripId);
  const row = await prisma.travelExpense.create({
    data: {
      tripId, userId, category: input.category, amountMinor: input.amountMinor,
      currency: "INR", status: input.status, description: input.description ?? null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    },
  });
  return expenseView(row);
}

function expenseView(row: {
  id: string; category: string; amountMinor: number; currency: string; status: string;
  description: string | null; occurredAt: Date;
}): TravelExpenseView {
  return {
    id: row.id, category: row.category, amountMinor: row.amountMinor, currency: row.currency,
    status: row.status, description: row.description, occurredAt: row.occurredAt.toISOString(),
  };
}

export async function listExpenses(userId: string, tripId: string): Promise<TravelExpenseView[]> {
  await load(userId, tripId);
  const rows = await prisma.travelExpense.findMany({ where: { tripId }, orderBy: { occurredAt: "desc" }, take: 200 });
  return rows.map(expenseView);
}
