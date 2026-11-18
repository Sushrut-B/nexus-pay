import { prisma } from "@nexus/database";
import { toSafeMinor } from "@/lib/payments/dto";

export type FinancialCategory =
  | "INCOME" | "EXPENSE" | "INTERNAL_TRANSFER" | "REFUND" | "CASHBACK" | "REWARD"
  | "SUBSCRIPTION" | "GROUP_SETTLEMENT" | "FEE" | "OTHER";

export interface ClassifiedRecord {
  sourceType: string;
  sourceId: string;
  category: FinancialCategory;
  direction: "IN" | "OUT" | "NEUTRAL";
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  description: string;
  merchantName: string | null;
  paymentRef: string | null;
  /** Adjustments reduce an existing expense category; they are not new income. */
  isAdjustment: boolean;
  classificationSource: string;
}

export interface QualityIssue {
  sourceType: string;
  sourceId: string;
  code: string;
  severity: string;
  details: string;
}

export interface ClassifiedResult {
  records: ClassifiedRecord[];
  issues: QualityIssue[];
  completenessBps: number;
}

/**
 * Build a unified, read-only view of the user's financial activity.
 * Rules are centralised here so every dashboard uses identical totals.
 *
 * - Simulated funding is never income (it is a sandbox reserve credit).
 * - Group expense obligations are not wallet transactions; group settlements
 *   are excluded from income/expense so reimbursement is not double-counted.
 * - A group settlement's underlying P2P transaction is excluded as well.
 * - Subscription payments are counted once via MerchantPayment(source=SUBSCRIPTION).
 * - Cashback counts as inflow only once CREDITED (verified wallet settlement).
 * - Reward points are never monetary.
 */
export async function loadClassifiedTransactions(
  userId: string,
  from: Date,
  to: Date,
  options: { includeExternal?: boolean } = {},
): Promise<ClassifiedResult> {
  const records: ClassifiedRecord[] = [];
  const issues: QualityIssue[] = [];

  const [transactions, merchantPayments, groupSettlements, cashback, categorizations, rewards, dataQuality, externalTransactions, confirmedTransfers] =
    await Promise.all([
      prisma.transactionRecord.findMany({
        where: { userId, status: "SUCCESSFUL", occurredAt: { gte: from, lte: to } },
        orderBy: { occurredAt: "asc" },
      }),
      prisma.merchantPayment.findMany({
        where: { customerUserId: userId, status: "SETTLED", createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.groupSettlement.findMany({
        where: {
          OR: [{ payerUserId: userId }, { payeeUserId: userId }],
          createdAt: { gte: from, lte: to },
        },
      }),
      prisma.cashbackEntitlement.findMany({
        where: { userId, status: "CREDITED", resolvedAt: { gte: from, lte: to } },
      }),
      prisma.transactionCategorization.findMany({ where: { userId } }),
      prisma.rewardLedgerEntry.findMany({
        where: { userId, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.financialDataQualityEvent.findMany({
        where: { userId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      options.includeExternal
        ? prisma.externalTransaction.findMany({
            where: { userId, transactionAt: { gte: from, lte: to } },
            include: { account: true },
          })
        : Promise.resolve([]),
      options.includeExternal
        ? prisma.internalTransferMatch.findMany({ where: { userId, status: "CONFIRMED" } })
        : Promise.resolve([]),
    ]);

  const categorized = new Set(categorizations.map((row) => row.paymentRef));
  const groupRefs = new Set(
    groupSettlements.map((settlement) => settlement.paymentRef).filter((value): value is string => Boolean(value)),
  );
  // A merchant payment is settled through the payment engine, which also writes a
  // P2P TransactionRecord. Count the merchant payment once and skip its duplicate.
  const merchantRefs = new Set(
    merchantPayments.map((payment) => payment.paymentRef).filter((value): value is string => Boolean(value)),
  );

  for (const transaction of transactions) {
    if (transaction.kind !== "P2P") {
      issues.push({
        sourceType: "TRANSACTION", sourceId: transaction.id, code: "UNKNOWN_TRANSACTION_TYPE",
        severity: "LOW", details: `Unsupported transaction kind ${transaction.kind}`,
      });
      continue;
    }
    if (transaction.paymentRef && groupRefs.has(transaction.paymentRef)) continue; // group settlement already represented
    if (transaction.paymentRef && merchantRefs.has(transaction.paymentRef)) continue; // merchant payment already represented
    if (transaction.status !== "SUCCESSFUL") continue;
    const amount = toSafeMinor(transaction.amountMinor) ?? 0;
    const received = transaction.direction === "RECEIVED";
    records.push({
      sourceType: "TRANSACTION",
      sourceId: transaction.id,
      category: received ? "INCOME" : "EXPENSE",
      direction: received ? "IN" : "OUT",
      amountMinor: amount,
      currency: transaction.currency,
      occurredAt: transaction.occurredAt,
      description: transaction.description ?? (received ? "Money received" : "Money sent"),
      merchantName: transaction.counterpartyName ?? null,
      paymentRef: transaction.paymentRef,
      isAdjustment: false,
      classificationSource: categorized.has(transaction.paymentRef ?? "") ? "USER_CATEGORY" : "RULE",
    });
    if (!transaction.paymentRef) {
      issues.push({
        sourceType: "TRANSACTION", sourceId: transaction.id, code: "UNRESOLVED_REFERENCE",
        severity: "MEDIUM", details: "Settled transaction has no payment reference",
      });
    } else if (!categorized.has(transaction.paymentRef)) {
      issues.push({
        sourceType: "TRANSACTION", sourceId: transaction.id, code: "MISSING_CATEGORY",
        severity: "LOW", details: "Transaction has no explicit category; defaulted by rule",
      });
    }
  }

  for (const payment of merchantPayments) {
    const isSubscription = payment.source === "SUBSCRIPTION";
    records.push({
      sourceType: "MERCHANT_PAYMENT",
      sourceId: payment.id,
      category: isSubscription ? "SUBSCRIPTION" : "EXPENSE",
      direction: "OUT",
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      occurredAt: payment.settledAt ?? payment.createdAt,
      description: isSubscription ? "Subscription payment" : "Merchant purchase",
      merchantName: null,
      paymentRef: payment.paymentRef,
      isAdjustment: false,
      classificationSource: "SOURCE",
    });
    if (payment.refundedMinor > 0) {
      records.push({
        sourceType: "MERCHANT_PAYMENT_REFUND",
        sourceId: `${payment.id}:refund`,
        category: "REFUND",
        direction: "IN",
        amountMinor: payment.refundedMinor,
        currency: payment.currency,
        occurredAt: payment.settledAt ?? payment.createdAt,
        description: "Refund adjustment against merchant purchase",
        merchantName: null,
        paymentRef: payment.paymentRef,
        isAdjustment: true,
        classificationSource: "SOURCE",
      });
    }
  }

  for (const settlement of groupSettlements) {
    const payer = settlement.payerUserId === userId;
    const amount = toSafeMinor(settlement.amountMinor) ?? 0;
    records.push({
      sourceType: "GROUP_SETTLEMENT",
      sourceId: settlement.id,
      category: "GROUP_SETTLEMENT",
      direction: payer ? "OUT" : "IN",
      amountMinor: amount,
      currency: settlement.currency,
      occurredAt: settlement.completedAt ?? settlement.createdAt,
      description: payer ? "Group settlement paid" : "Group settlement received",
      merchantName: null,
      paymentRef: settlement.paymentRef,
      isAdjustment: false,
      classificationSource: "SOURCE",
    });
  }

  for (const entitlement of cashback) {
    records.push({
      sourceType: "CASHBACK",
      sourceId: entitlement.id,
      category: "CASHBACK",
      direction: "IN",
      amountMinor: entitlement.amountMinor,
      currency: entitlement.currency,
      occurredAt: entitlement.resolvedAt ?? entitlement.createdAt,
      description: "Verified sandbox cashback credit",
      merchantName: null,
      paymentRef: entitlement.paymentRef,
      isAdjustment: false,
      classificationSource: "VERIFIED_SETTLEMENT",
    });
  }

  // External transactions are reported provider data, never Nexus Pay payments.
  // Only confirmed internal transfers are excluded from consolidated totals.
  const excludedExternal = new Set(
    confirmedTransfers.flatMap((match) => [match.debitTxId, match.creditTxId]),
  );
  for (const transaction of externalTransactions) {
    if (excludedExternal.has(transaction.id)) continue;
    const received = transaction.direction === "IN";
    const category = received ? "INCOME" : "EXPENSE";
    records.push({
      sourceType: "EXTERNAL_TRANSACTION",
      sourceId: transaction.id,
      category,
      direction: received ? "IN" : "OUT",
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      occurredAt: transaction.transactionAt,
      description: transaction.description,
      merchantName: transaction.merchant ?? transaction.account.institutionName,
      paymentRef: transaction.externalRef,
      isAdjustment: false,
      classificationSource: "PROVIDER_REPORTED",
    });
  }

  // Reward points are recorded for audit/history but excluded from money totals.
  for (const entry of rewards) {
    records.push({
      sourceType: "REWARD_LEDGER",
      sourceId: entry.id,
      category: "REWARD",
      direction: "NEUTRAL",
      amountMinor: 0,
      currency: "INR",
      occurredAt: entry.createdAt,
      description: `${entry.type}: ${entry.description}`,
      merchantName: null,
      paymentRef: entry.transactionRef,
      isAdjustment: false,
      classificationSource: "LEDGER",
    });
  }

  const monetary = records.filter((record) => record.category !== "REWARD");
  const total = monetary.length;
  const unclassified = monetary.filter((record) => record.classificationSource === "RULE").length;
  for (const issue of dataQuality) {
    issues.push({
      sourceType: issue.sourceType, sourceId: issue.sourceId, code: issue.issueCode,
      severity: issue.severity, details: issue.details ?? issue.issueCode,
    });
  }

  return {
    records,
    issues,
    completenessBps: total === 0 ? 10_000 : Math.round(((total - unclassified) / total) * 10_000),
  };
}

export function moneyMovements(records: ClassifiedRecord[]) {
  let inflow = 0;
  let outflow = 0;
  for (const record of records) {
    if (record.category === "REWARD" || record.category === "GROUP_SETTLEMENT" || record.category === "INTERNAL_TRANSFER") continue;
    if (record.direction === "IN" && !record.isAdjustment) inflow += record.amountMinor;
    else if (record.direction === "OUT") outflow += record.amountMinor;
  }
  // Refund adjustments reduce the expense total rather than increasing inflow.
  const refundAdjustments = records
    .filter((record) => record.category === "REFUND" && record.isAdjustment)
    .reduce((sum, record) => sum + record.amountMinor, 0);
  outflow = Math.max(0, outflow - refundAdjustments);
  return { inflowMinor: inflow, outflowMinor: outflow, netMinor: inflow - outflow };
}
