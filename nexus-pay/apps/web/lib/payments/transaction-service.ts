import { prisma } from "@nexus/database";
import type {
  FundingView,
  HistoryFilter,
  HistorySort,
  MonthlySummary,
  RecentRecipient,
  TransactionDetail,
  TransactionListResult,
  TransactionParties,
} from "@nexus/shared-types";
import type { HistoryQueryInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { toFundingView, toPaymentView, toSafeMinor, toTransactionSummary } from "@/lib/payments/dto";
import { reconcileFundingOperation } from "@/lib/payments/funding-service";
import { reconcilePaymentIntent } from "@/lib/payments/payment-service";

const REQUESTED_STATUSES: Record<HistoryFilter, { statuses?: string[]; direction?: string }> = {
  ALL: {},
  SENT: { direction: "SENT" },
  RECEIVED: { direction: "RECEIVED" },
  SUCCESSFUL: { statuses: ["SUCCESSFUL"] },
  FAILED: { statuses: ["FAILED"] },
  PROCESSING: { statuses: ["PROCESSING", "RECONCILIATION_REQUIRED"] },
};

const UNRESOLVED_PAYMENT_STATUSES = ["PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] as const;
const UNRESOLVED_FUNDING_STATUSES = ["PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] as const;

export async function listTransactions(
  userId: string,
  query: HistoryQueryInput,
): Promise<TransactionListResult> {
  await reconcileVisibleUnresolved(userId);

  const filter = REQUESTED_STATUSES[query.filter] ?? {};
  const search = query.search?.trim();
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (query.from) dateFilter.gte = new Date(`${query.from}T00:00:00.000Z`);
  if (query.to) dateFilter.lte = new Date(`${query.to}T23:59:59.999Z`);

  const where = {
    userId,
    ...(filter.direction ? { direction: filter.direction as "SENT" | "RECEIVED" } : {}),
    ...(filter.statuses
      ? {
          status: {
            in: filter.statuses as Array<
              "PROCESSING" | "SUCCESSFUL" | "FAILED" | "RECONCILIATION_REQUIRED"
            >,
          },
        }
      : {}),
    ...(Object.keys(dateFilter).length > 0 ? { occurredAt: dateFilter } : {}),
    ...(search
      ? {
          OR: [
            { counterpartyName: { contains: search, mode: "insensitive" as const } },
            { counterpartyUsername: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
            { paymentRef: { contains: search, mode: "insensitive" as const } },
            { id: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, records] = await Promise.all([
    prisma.transactionRecord.count({ where }),
    prisma.transactionRecord.findMany({
      where,
      orderBy: { occurredAt: query.sort === "oldest" ? "asc" : "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: records.map(toTransactionSummary),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    filter: query.filter,
    sort: query.sort,
    search: search ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
  };
}

export async function getRecentTransactions(
  userId: string,
  limit = 5,
): Promise<TransactionListResult["items"]> {
  const records = await prisma.transactionRecord.findMany({
    where: { userId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
  return records.map(toTransactionSummary);
}

export async function getMonthlySummary(
  userId: string,
  currency = "INR",
): Promise<MonthlySummary> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [sent, received, transactionCount] = await Promise.all([
    prisma.transactionRecord.aggregate({
      where: {
        userId,
        direction: "SENT",
        status: "SUCCESSFUL",
        currency,
        occurredAt: { gte: monthStart },
      },
      _sum: { amountMinor: true },
    }),
    prisma.transactionRecord.aggregate({
      where: {
        userId,
        direction: "RECEIVED",
        status: "SUCCESSFUL",
        currency,
        occurredAt: { gte: monthStart },
      },
      _sum: { amountMinor: true },
    }),
    prisma.transactionRecord.count({
      where: { userId, currency, occurredAt: { gte: monthStart } },
    }),
  ]);

  return {
    monthStart: monthStart.toISOString(),
    sentMinor: toSafeMinor(sent._sum.amountMinor) ?? 0,
    receivedMinor: toSafeMinor(received._sum.amountMinor) ?? 0,
    transactionCount,
    currency,
  };
}

export async function getRecentRecipients(
  userId: string,
  limit = 4,
): Promise<RecentRecipient[]> {
  const records = await prisma.transactionRecord.findMany({
    where: {
      userId,
      kind: "P2P",
      direction: "SENT",
      counterpartyUsername: { not: null },
      status: { in: ["SUCCESSFUL", "PROCESSING", "RECONCILIATION_REQUIRED"] },
    },
    orderBy: { occurredAt: "desc" },
    take: 40,
    select: {
      counterpartyName: true,
      counterpartyUsername: true,
    },
  });

  const seen = new Set<string>();
  const recipients: RecentRecipient[] = [];
  for (const record of records) {
    if (!record.counterpartyUsername) continue;
    if (seen.has(record.counterpartyUsername)) continue;
    seen.add(record.counterpartyUsername);
    recipients.push({
      displayName: record.counterpartyName ?? record.counterpartyUsername,
      username: record.counterpartyUsername,
    });
    if (recipients.length >= limit) break;
  }
  return recipients;
}

export async function getFundingHistory(userId: string, limit = 10): Promise<FundingView[]> {
  const operations = await prisma.fundingOperation.findMany({
    where: { userId },
    include: { transaction: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return operations.map((operation) => toFundingView(operation, operation.transaction));
}

export async function getTransactionDetail(
  userId: string,
  idOrReference: string,
): Promise<TransactionDetail> {
  let record = await locateRecord(userId, idOrReference);
  record = await reconcileRecord(record);
  const intent = await findIntentForRecord(record);

  const parties = buildParties(record, intent);
  const replay =
    intent?.lastWasIdempotentReplay ?? record.fundingOperation?.lastWasIdempotentReplay ?? false;

  return {
    transaction: toTransactionSummary(record),
    reference: record.paymentRef ?? record.id,
    rail: record.kind === "FUNDING" ? "SIMULATED_FUNDING" : "INTERNAL_BOOK",
    parties,
    idempotentReplay: replay,
    payment: intent ? toPaymentView(intent, record) : null,
    funding: record.fundingOperation
      ? toFundingView(record.fundingOperation, record)
      : null,
    timeline: buildTimeline(record),
  };
}

export async function getReceiptRecord(
  userId: string,
  idOrReference: string,
) {
  let record = await locateRecord(userId, idOrReference);
  record = await reconcileRecord(record);

  if (record.status !== "SUCCESSFUL" || !record.paymentRef) {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      "A receipt is only available after the ledger outcome is verified as successful.",
    );
  }
  if (record.paymentIntent && !record.paymentIntent.receiptVerifiedAt) {
    throw new ApiError(409, "PAYMENT_ERROR", "This payment has not been verified by the ledger.");
  }
  if (record.fundingOperation && !record.fundingOperation.receiptVerifiedAt) {
    throw new ApiError(409, "PAYMENT_ERROR", "This funding request has not been verified by the ledger.");
  }
  return record;
}

type LocatedRecord = Awaited<ReturnType<typeof locateRecord>>;
type LocatedIntent = Awaited<ReturnType<typeof findIntentForRecord>>;

async function locateRecord(userId: string, idOrReference: string) {
  const record = await prisma.transactionRecord.findFirst({
    where: {
      userId,
      OR: [{ id: idOrReference }, { paymentRef: idOrReference }],
    },
    include: {
      paymentIntent: true,
      fundingOperation: true,
      user: { include: { profile: true } },
    },
  });
  if (!record) {
    throw new ApiError(404, "PAYMENT_ERROR", "This transaction could not be found.");
  }
  return record;
}

async function findIntentForRecord(record: LocatedRecord) {
  const paymentRef = record.paymentIntent?.paymentRef ?? record.paymentRef;
  if (record.kind !== "P2P" || !paymentRef) return null;
  return prisma.paymentIntent.findUnique({
    where: { paymentRef },
    include: { user: { include: { profile: true } } },
  });
}

async function reconcileRecord(record: LocatedRecord): Promise<LocatedRecord> {
  const intent = await findIntentForRecord(record);
  if (intent && (UNRESOLVED_PAYMENT_STATUSES as readonly string[]).includes(intent.status)) {
    await reconcilePaymentIntent(intent).catch(() => intent);
  }
  if (
    record.fundingOperation &&
    (UNRESOLVED_FUNDING_STATUSES as readonly string[]).includes(record.fundingOperation.status)
  ) {
    await reconcileFundingOperation(record.fundingOperation).catch(
      () => record.fundingOperation,
    );
  }
  const refreshed = await locateRecord(record.userId, record.id);
  return refreshed;
}

function buildParties(record: LocatedRecord, intent: LocatedIntent): TransactionParties {
  const ownerName = record.user.profile?.displayName ?? record.user.fullName;
  const ownerUsername = record.user.username;

  if (record.kind === "FUNDING") {
    return {
      sender: {
        displayName: "Simulated sandbox reserve",
        username: null,
        kind: "SIMULATED_RESERVE",
      },
      recipient: { displayName: ownerName, username: ownerUsername, kind: "CUSTOMER" },
    };
  }

  const sender = intent
    ? {
        displayName: intent.user.profile?.displayName ?? intent.user.fullName,
        username: intent.user.username,
        kind: "CUSTOMER" as const,
      }
    : record.direction === "SENT"
      ? { displayName: ownerName, username: ownerUsername, kind: "CUSTOMER" as const }
      : { displayName: "Nexus Pay customer", username: null, kind: "CUSTOMER" as const };

  const recipient = intent
    ? {
        displayName: intent.recipientDisplayName,
        username: intent.recipientUsername,
        kind: "CUSTOMER" as const,
      }
    : record.direction === "RECEIVED"
      ? { displayName: ownerName, username: ownerUsername, kind: "CUSTOMER" as const }
      : {
          displayName: record.counterpartyName ?? "Nexus Pay customer",
          username: record.counterpartyUsername,
          kind: "CUSTOMER" as const,
        };

  return { sender, recipient };
}

/**
 * Before showing history, try to resolve recent in-flight rows. Only verified
 * receipts can change a status; failures to reach Raftline leave it untouched.
 */
async function reconcileVisibleUnresolved(userId: string): Promise<void> {
  const [paymentIntents, fundingOperations] = await Promise.all([
    prisma.paymentIntent.findMany({
      where: { userId, status: { in: [...UNRESOLVED_PAYMENT_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.fundingOperation.findMany({
      where: { userId, status: { in: [...UNRESOLVED_FUNDING_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  await Promise.all([
    ...paymentIntents.map((intent) => reconcilePaymentIntent(intent).catch(() => intent)),
    ...fundingOperations.map((operation) =>
      reconcileFundingOperation(operation).catch(() => operation),
    ),
  ]);
}

function buildTimeline(record: LocatedRecord): TransactionDetail["timeline"] {
  const created = record.createdAt.toISOString();
  const occurred = record.occurredAt.toISOString();

  if (record.paymentIntent) {
    const intent = record.paymentIntent;
    return [
      { label: "Payment created", at: intent.createdAt.toISOString(), complete: true },
      {
        label: intent.attemptCount > 0 ? "Sent to the ledger" : "Not yet sent",
        at: intent.lastAttemptAt?.toISOString() ?? null,
        complete: intent.attemptCount > 0,
      },
      {
        label:
          intent.status === "SETTLED"
            ? "Verified as settled"
            : intent.status === "REJECTED"
              ? "Verified as rejected"
              : "Awaiting verified outcome",
        at: intent.receiptVerifiedAt?.toISOString() ?? intent.settledAt?.toISOString() ?? null,
        complete: intent.status === "SETTLED" || intent.status === "REJECTED",
      },
    ];
  }

  if (record.fundingOperation) {
    const operation = record.fundingOperation;
    return [
      {
        label: "Simulated funding created",
        at: operation.createdAt.toISOString(),
        complete: true,
      },
      {
        label: operation.attemptCount > 0 ? "Sent to the ledger" : "Not yet sent",
        at: operation.lastAttemptAt?.toISOString() ?? null,
        complete: operation.attemptCount > 0,
      },
      {
        label:
          operation.status === "COMPLETED"
            ? "Verified as settled"
            : operation.status === "FAILED"
              ? "Verified as failed"
              : "Awaiting verified outcome",
        at: operation.receiptVerifiedAt?.toISOString() ?? operation.completedAt?.toISOString() ?? null,
        complete: operation.status === "COMPLETED" || operation.status === "FAILED",
      },
    ];
  }

  return [
    {
      label: record.direction === "RECEIVED" ? "Payment received" : "Payment sent",
      at: created,
      complete: true,
    },
    {
      label: record.status === "SUCCESSFUL" ? "Verified as settled" : "Outcome",
      at: occurred,
      complete: record.status === "SUCCESSFUL",
    },
  ];
}

export function sortLabel(sort: HistorySort): string {
  return sort === "oldest" ? "Oldest first" : "Newest first";
}
