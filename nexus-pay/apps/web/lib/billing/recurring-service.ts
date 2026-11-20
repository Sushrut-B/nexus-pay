import { prisma } from "@nexus/database";
import type { RecurringBillView, BillReminderView } from "@nexus/shared-types";
import type { RecurringBillInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { createNotification } from "@/lib/social/shared";

const INTERVAL_DAYS: Record<string, number> = { MONTHLY: 30, QUARTERLY: 90, YEARLY: 365 };

export function recurringView(row: {
  id: string; billerId: string; pattern: string; expectedMinMinor: number | null;
  expectedMaxMinor: number | null; lastPaymentDate: Date | null; nextExpectedDate: Date | null;
  confirmedByUser: boolean; status: string;
}): RecurringBillView {
  return {
    id: row.id, billerId: row.billerId, pattern: row.pattern,
    expectedMinMinor: row.expectedMinMinor, expectedMaxMinor: row.expectedMaxMinor,
    lastPaymentDate: row.lastPaymentDate?.toISOString() ?? null,
    nextExpectedDate: row.nextExpectedDate?.toISOString() ?? null,
    confirmedByUser: row.confirmedByUser, status: row.status,
  };
}

export async function listRecurring(userId: string) {
  const rows = await prisma.recurringBill.findMany({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map(recurringView);
}

export async function createRecurring(userId: string, input: RecurringBillInput) {
  const next = new Date(Date.now() + (INTERVAL_DAYS[input.pattern] ?? 30) * 86_400_000);
  const row = await prisma.recurringBill.create({
    data: {
      userId, billerId: input.billerId, accountId: input.accountId ?? null,
      pattern: input.pattern, expectedMinMinor: input.expectedMinMinor ?? null,
      expectedMaxMinor: input.expectedMaxMinor ?? null,
      confirmedByUser: input.confirmedByUser, nextExpectedDate: next,
    },
  });
  return recurringView(row);
}

export async function updateRecurring(userId: string, id: string, input: Partial<RecurringBillInput>) {
  const row = await prisma.recurringBill.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Recurring bill not found.");
  const updated = await prisma.recurringBill.update({
    where: { id },
    data: {
      ...(input.pattern ? { pattern: input.pattern } : {}),
      ...(input.expectedMinMinor !== undefined ? { expectedMinMinor: input.expectedMinMinor } : {}),
      ...(input.expectedMaxMinor !== undefined ? { expectedMaxMinor: input.expectedMaxMinor } : {}),
      ...(input.confirmedByUser !== undefined ? { confirmedByUser: input.confirmedByUser } : {}),
    },
  });
  return recurringView(updated);
}

export async function deleteRecurring(userId: string, id: string) {
  await prisma.recurringBill.updateMany({ where: { id, userId }, data: { status: "INACTIVE" } });
  return { id, deleted: true };
}

function reminderView(row: {
  id: string; billerId: string; kind: string; dueAt: Date; status: string; sentAt: Date | null;
}): BillReminderView {
  return { id: row.id, billerId: row.billerId, kind: row.kind, dueAt: row.dueAt.toISOString(), status: row.status, sentAt: row.sentAt?.toISOString() ?? null };
}

export async function listReminders(userId: string) {
  const rows = await prisma.billReminder.findMany({ where: { userId, status: { in: ["PENDING", "SENT"] } }, orderBy: { dueAt: "asc" }, take: 100 });
  return rows.map(reminderView);
}

/** Creates reminders at provider-configurable intervals. Deduplicated by unique key. */
export async function createRemindersForBill(input: {
  userId: string; accountId: string | null; billerId: string; dueAt: Date;
}) {
  const offsets = [0, 1, 3, getServerEnv().NEXUS_BILLING_REMINDER_DAYS];
  const created = [];
  for (const days of offsets) {
    const dueAt = new Date(input.dueAt.getTime() - days * 86_400_000);
    const kind = days === 0 ? "DUE_DATE" : `DAYS_${days}`;
    const row = await prisma.billReminder.upsert({
      where: { userId_accountId_kind_dueAt: { userId: input.userId, accountId: input.accountId ?? "", kind, dueAt } },
      create: { userId: input.userId, accountId: input.accountId, billerId: input.billerId, kind, dueAt },
      update: {},
    });
    created.push(reminderView(row));
  }
  return created;
}

/** Sends due reminders once, with a truthful "not confirmed paid" message. */
export async function runReminderWorker(limit = 50) {
  const due = await prisma.billReminder.findMany({
    where: { status: "PENDING", dueAt: { lte: new Date() } }, orderBy: { dueAt: "asc" }, take: limit,
  });
  let sent = 0;
  for (const reminder of due) {
    const claimed = await prisma.billReminder.updateMany({ where: { id: reminder.id, status: "PENDING" }, data: { status: "SENT", sentAt: new Date() } });
    if (claimed.count === 0) continue;
    try {
      await createNotification(prisma, {
        userId: reminder.userId,
        type: reminder.kind === "OVERDUE" ? "BILL_OVERDUE" : "BILL_DUE_SOON",
        title: reminder.kind === "OVERDUE" ? "Bill overdue" : "Bill due soon",
        body: "A saved bill's due date was reached. No payment has been made automatically. Open Bill Payments to review the latest provider-fetched bill.",
        data: { billerId: reminder.billerId, reminderId: reminder.id },
      });
      sent += 1;
    } catch {
      await prisma.billReminder.update({ where: { id: reminder.id }, data: { status: "FAILED" } });
    }
  }
  return { sent };
}

/** Detects recurrence only from confirmed payment history, never from a single fetch. */
export async function detectRecurringBills(userId: string) {
  const grouped = await prisma.billPaymentIntent.findMany({
    where: { userId, status: "BILLER_CONFIRMED" }, include: { biller: true },
    orderBy: { createdAt: "asc" }, take: 500,
  });
  const byBiller = new Map<string, typeof grouped>();
  for (const payment of grouped) {
    const list = byBiller.get(payment.billerId) ?? [];
    list.push(payment);
    byBiller.set(payment.billerId, list);
  }
  let detected = 0;
  for (const [billerId, payments] of byBiller) {
    if (payments.length < 2) continue;
    const existing = await prisma.recurringBill.findFirst({ where: { userId, billerId } });
    if (existing) continue;
    const amounts = payments.map((p) => p.amountMinor).sort((a, b) => a - b);
    await prisma.recurringBill.create({
      data: {
        userId, billerId, accountId: payments[0]!.accountId,
        pattern: "MONTHLY", expectedMinMinor: amounts[0]!, expectedMaxMinor: amounts[amounts.length - 1]!,
        lastPaymentDate: payments[payments.length - 1]!.confirmedAt,
        nextExpectedDate: new Date(Date.now() + 30 * 86_400_000),
        confirmedByUser: false,
      },
    });
    detected += 1;
  }
  return { detected };
}
