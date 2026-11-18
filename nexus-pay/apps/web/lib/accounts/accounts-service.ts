import { prisma } from "@nexus/database";
import type { AccountAnalyticsView, ConnectionView, ExternalAccountView, PrivacyDataView, UnifiedTransactionView } from "@nexus/shared-types";
import type { AccountQueryInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { toSafeMinor } from "@/lib/payments/dto";
import { loadClassifiedTransactions, moneyMovements } from "@/lib/finance-intelligence/classification-service";
import { resolveFinancePeriod } from "@/lib/finance-intelligence/aggregation-service";
import { confirmedTransferIds } from "@/lib/accounts/transfer-service";
import { decryptSecret } from "@/lib/security/crypto";

export async function listAccounts(userId: string): Promise<ExternalAccountView[]> {
  const wallet = await getWalletOverviewForUser(userId);
  const walletBalance = wallet?.balance?.availableMinor ?? 0;
  const result: ExternalAccountView[] = [{
    id: "nexus-wallet",
    connectionId: "nexus-wallet",
    providerName: "Nexus Pay",
    accountType: "NEXUS_WALLET",
    institutionName: "Nexus Pay",
    maskedIdentifier: "WALLET",
    currency: "INR",
    status: "ACTIVE",
    balanceMinor: walletBalance,
    availableMinor: walletBalance,
    liability: false,
    lastSyncAt: null,
    consentStatus: null,
    creditDetails: null,
    isWallet: true,
    isSandbox: false,
  }];

  const accounts = await prisma.externalFinancialAccount.findMany({
    where: { userId },
    include: {
      connection: { include: { provider: true } },
      balances: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });
  for (const account of accounts) {
    const snapshot = account.balances[0];
    const isWallet = account.accountType === "NEXUS_WALLET";
    result.push({
      id: account.id,
      connectionId: account.connectionId,
      providerName: account.connection.provider.displayName,
      accountType: account.accountType,
      institutionName: account.institutionName,
      maskedIdentifier: account.maskedIdentifier,
      currency: account.currency,
      status: account.status,
      balanceMinor: snapshot ? Number(snapshot.reportedBalanceMinor) : null,
      availableMinor: snapshot?.availableBalanceMinor === null || snapshot?.availableBalanceMinor === undefined ? null : Number(snapshot.availableBalanceMinor),
      liability: account.accountType === "CREDIT_CARD" || account.accountType === "LOAN",
      lastSyncAt: account.connection.lastSyncAt?.toISOString() ?? null,
      consentStatus: null,
      creditDetails: account.accountType === "CREDIT_CARD" && snapshot
        ? {
            outstandingMinor: snapshot.outstandingMinor === null ? null : Number(snapshot.outstandingMinor),
            availableCreditMinor: snapshot.availableCreditMinor === null ? null : Number(snapshot.availableCreditMinor),
            statementMinor: snapshot.statementMinor === null ? null : Number(snapshot.statementMinor),
            minimumDueMinor: snapshot.minimumDueMinor === null ? null : Number(snapshot.minimumDueMinor),
            paymentDueDate: snapshot.paymentDueDate?.toISOString() ?? null,
          }
        : null,
      isWallet,
      isSandbox: account.connection.provider.mode === "SANDBOX",
    });
  }
  return result;
}

export async function getAccount(userId: string, id: string): Promise<ExternalAccountView> {
  const accounts = await listAccounts(userId);
  const account = accounts.find((item) => item.id === id);
  if (!account) throw new ApiError(404, "AUTHORIZATION_ERROR", "Account not found.");
  return account;
}

export async function getUnifiedTransactions(userId: string, query: AccountQueryInput): Promise<{ items: UnifiedTransactionView[]; total: number }> {
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(Date.now() - 90 * 86_400_000);
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const classified = await loadClassifiedTransactions(userId, from, to, { includeExternal: true });
  const items: UnifiedTransactionView[] = [];

  if (query.scope !== "ACCOUNT") {
    for (const record of classified.records.filter((row) => row.sourceType === "TRANSACTION" || row.sourceType === "MERCHANT_PAYMENT")) {
      items.push({
        id: record.sourceId,
        source: "NEXUS_WALLET",
        accountId: "nexus-wallet",
        institution: "Nexus Pay",
        maskedAccount: "WALLET",
        description: record.description,
        merchant: record.merchantName,
        amountMinor: record.amountMinor,
        currency: record.currency,
        direction: record.direction === "IN" ? "IN" : "OUT",
        transactionAt: record.occurredAt.toISOString(),
        postedAt: null,
        status: "POSTED",
        category: record.category,
        externalRef: record.paymentRef,
        isSandbox: false,
      });
    }
  }
  if (query.scope !== "WALLET") {
    const excluded = await confirmedTransferIds(userId);
    const external = await prisma.externalTransaction.findMany({
      where: {
        userId,
        transactionAt: { gte: from, lte: to },
        ...(query.accountId ? { accountId: query.accountId } : {}),
      },
      include: { account: { include: { connection: { include: { provider: true } } } } },
      orderBy: { transactionAt: "desc" },
      take: 500,
    });
    for (const transaction of external) {
      items.push({
        id: transaction.id,
        source: "EXTERNAL",
        accountId: transaction.accountId,
        institution: transaction.account.institutionName,
        maskedAccount: transaction.account.maskedIdentifier,
        description: transaction.description,
        merchant: transaction.merchant,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
        direction: transaction.direction as "IN" | "OUT",
        transactionAt: transaction.transactionAt.toISOString(),
        postedAt: transaction.postedAt?.toISOString() ?? null,
        status: excluded.has(transaction.id) ? "INTERNAL_TRANSFER" : transaction.status,
        category: transaction.category,
        externalRef: transaction.externalRef,
        isSandbox: transaction.account.connection.provider.mode === "SANDBOX",
      });
    }
  }
  items.sort((a, b) => b.transactionAt.localeCompare(a.transactionAt));
  const total = items.length;
  return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total };
}

export async function getAccountAnalytics(
  userId: string,
  scope: "WALLET" | "ACCOUNT" | "ALL",
  accountId?: string,
  period: "week" | "month" | "last_month" | "quarter" | "half_year" | "year" | "custom" = "month",
  from?: string,
  to?: string,
): Promise<AccountAnalyticsView> {
  const window = resolveFinancePeriod(period, from, to);
  const classified = await loadClassifiedTransactions(userId, window.from, window.to, { includeExternal: scope !== "WALLET" });
  const totals = moneyMovements(classified.records);
  const accounts = await listAccounts(userId);
  const selected = scope === "WALLET"
    ? accounts.filter((account) => account.isWallet)
    : scope === "ACCOUNT"
      ? accounts.filter((account) => account.id === accountId)
      : accounts;

  let cashBalanceMinor = 0;
  let liabilityMinor = 0;
  for (const account of selected) {
    const balance = account.balanceMinor ?? 0;
    if (account.liability) liabilityMinor += Math.abs(balance);
    else cashBalanceMinor += balance;
  }
  const excluded = (await confirmedTransferIds(userId)).size;
  return {
    scope: scope === "ACCOUNT" ? `Account ${accountId ?? ""}` : scope === "WALLET" ? "Nexus Pay wallet only" : "All connected accounts",
    cashBalanceMinor,
    liabilityMinor,
    netPositionMinor: cashBalanceMinor - liabilityMinor,
    inflowMinor: totals.inflowMinor,
    outflowMinor: totals.outflowMinor,
    excludedInternalTransfersMinor: excluded,
    transactionCount: classified.records.length,
    accountBreakdown: selected.map((account) => ({
      accountId: account.id,
      label: `${account.institutionName} ${account.maskedIdentifier}`,
      balanceMinor: account.balanceMinor ?? 0,
      liability: account.liability,
      transactionCount: 0,
    })),
    currency: "INR",
    notice: "External balances are provider-reported and read-only. Credit card and loan amounts are liabilities and are never added to cash balances. Only confirmed internal transfers are excluded from inflows/outflows.",
  };
}

export async function getPrivacyData(userId: string): Promise<PrivacyDataView> {
  const [connections, consents, accesses, deletions] = await Promise.all([
    prisma.externalAccountConnection.findMany({ where: { userId }, include: { provider: true }, orderBy: { createdAt: "desc" } }),
    prisma.externalAccountConsent.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.dataAccessAuditEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.dataAccessAuditEvent.findMany({ where: { userId, action: "DATA_DELETION_REQUESTED" }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return {
    providers: connections.map((connection) => ({
      name: connection.provider.displayName,
      mode: connection.provider.mode,
      connectedAt: connection.createdAt.toISOString(),
    })),
    activeConsents: consents.filter((consent) => consent.status === "ACTIVE").length,
    revokedConsents: consents.filter((consent) => consent.status === "REVOKED").length,
    lastRetrievalAt: connections.map((connection) => connection.lastSyncAt).filter(Boolean).sort().at(-1)?.toISOString() ?? null,
    dataCategories: [...new Set(consents.flatMap((consent) => consent.dataCategories))],
    retentionNotice: "Imported provider data is retained only while consent is active, subject to legal and audit retention requirements. Revocation stops future retrieval immediately.",
    accesses: accesses.map((access) => ({ action: access.action, target: access.targetId, at: access.createdAt.toISOString() })),
    deletionRequests: deletions.map((request) => ({
      id: request.id, status: "RECORDED", createdAt: request.createdAt.toISOString(),
    })),
  };
}

export async function requestDataDeletion(userId: string, reason: string, accountId?: string) {
  if (accountId) {
    const account = await prisma.externalFinancialAccount.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new ApiError(404, "AUTHORIZATION_ERROR", "Account not found.");
  }
  return prisma.dataAccessAuditEvent.create({
    data: {
      userId, actorType: "USER", actorId: userId, action: "DATA_DELETION_REQUESTED",
      targetType: accountId ? "external_account" : "user_data", targetId: accountId ?? userId,
      metadata: { reason },
    },
  });
}

/** Used by tests and admin inspection only; never returned to API responses. */
export async function inspectEncryptedAccountReference(userId: string, accountId: string) {
  const account = await prisma.externalFinancialAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new ApiError(404, "AUTHORIZATION_ERROR", "Account not found.");
  return decryptSecret(account.encryptedAccountRef);
}

export function toSafeAmount(value: bigint | number | null): number {
  return toSafeMinor(value) ?? 0;
}

export async function getConnectionSummary(userId: string): Promise<ConnectionView[]> {
  const connections = await prisma.externalAccountConnection.findMany({
    where: { userId }, include: { provider: true, accounts: true, consents: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  return connections.map((connection) => ({
    id: connection.id,
    providerId: connection.providerId,
    providerName: connection.provider.displayName,
    status: connection.status,
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
    lastError: connection.lastError,
    accountCount: connection.accounts.length,
    activeConsentId: connection.consents.find((consent) => consent.status === "ACTIVE")?.id ?? null,
    createdAt: connection.createdAt.toISOString(),
  }));
}
