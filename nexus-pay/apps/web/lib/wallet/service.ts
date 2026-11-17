import { createRaftlineClient, RaftlineError, type RaftlinePaymentsClient } from "@nexus/api-client";
import { prisma, type Wallet } from "@nexus/database";
import type { WalletOverview, WalletSummary, WalletListResult, CurrencyCode } from "@nexus/shared-types";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api/response";

const PROVISIONING_LEASE_MS = 2 * 60 * 1000;

const globalForRaftline = globalThis as unknown as {
  nexusPayRaftlineClient?: RaftlinePaymentsClient;
};

function getRaftlineClient(): RaftlinePaymentsClient {
  if (!globalForRaftline.nexusPayRaftlineClient) {
    globalForRaftline.nexusPayRaftlineClient = createRaftlineClient();
  }
  return globalForRaftline.nexusPayRaftlineClient;
}

export function walletAccountId(wallet: Pick<Wallet, "userId" | "currency">): string {
  return `np_${wallet.userId}_${wallet.currency.toLowerCase()}`;
}

export function toWalletSummary(wallet: Wallet): WalletSummary {
  return {
    id: wallet.id,
    status: wallet.status,
    currency: wallet.currency as CurrencyCode,
    raftlineAccountId: wallet.raftlineAccountId,
    provisionedAt: wallet.provisionedAt?.toISOString() ?? null,
    lastProvisioningError: wallet.lastProvisioningError,
    createdAt: wallet.createdAt.toISOString(),
  };
}

export async function buildWalletOverview(wallet: Wallet): Promise<WalletOverview> {
  const summary = toWalletSummary(wallet);
  const fetchedAt = new Date().toISOString();

  if (wallet.status !== "ACTIVE" || !wallet.raftlineAccountId) {
    return {
      wallet: summary,
      balance: null,
      balanceUnavailableReason: "WALLET_NOT_ACTIVE",
      fetchedAt,
    };
  }

  try {
    const account = await getRaftlineClient().getAccount(wallet.raftlineAccountId);
    if (!account) {
      return {
        wallet: summary,
        balance: null,
        balanceUnavailableReason: "ACCOUNT_NOT_FOUND",
        fetchedAt,
      };
    }
    if (account.currency !== wallet.currency) {
      return {
        wallet: summary,
        balance: null,
        balanceUnavailableReason: "ACCOUNT_NOT_FOUND",
        fetchedAt,
      };
    }
    const reservedMinor = account.reservedCents;
    const availableMinor = account.availableBalanceCents;
    return {
      wallet: summary,
      balance: {
        amountMinor: availableMinor,
        availableMinor,
        reservedMinor,
        ledgerBalanceMinor: account.balanceCents,
        currency: wallet.currency as CurrencyCode,
        fetchedAt,
        source: "RAFTLINE",
      },
      balanceUnavailableReason: null,
      fetchedAt,
    };
  } catch (error) {
    const reason =
      error instanceof RaftlineError && error.code === "TIMEOUT"
        ? "RAFTLINE_TIMEOUT"
        : "RAFTLINE_UNAVAILABLE";
    return {
      wallet: summary,
      balance: null,
      balanceUnavailableReason: reason,
      fetchedAt,
    };
  }
}

export async function listWalletOverviewsForUser(userId: string): Promise<WalletListResult> {
  const wallets = await prisma.wallet.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
  });
  const overviews = await Promise.all(wallets.map((wallet) => buildWalletOverview(wallet)));
  return {
    wallets: overviews,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getWalletOverviewForUserById(
  userId: string,
  walletId: string,
): Promise<WalletOverview> {
  const wallet = await prisma.wallet.findFirst({ where: { id: walletId, userId } });
  if (!wallet) {
    throw new ApiError(404, "AUTHORIZATION_ERROR", "This wallet could not be found.");
  }
  return buildWalletOverview(wallet);
}

export async function getWalletBalanceForUser(
  userId: string,
  walletId: string,
): Promise<WalletOverview> {
  return getWalletOverviewForUserById(userId, walletId);
}

export async function getWalletOverviewForUser(userId: string): Promise<WalletOverview | null> {
  const wallet = await prisma.wallet.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (!wallet) return null;
  return buildWalletOverview(wallet);
}

export async function provisionWallet(userId: string): Promise<WalletOverview> {
  let wallet = await prisma.wallet.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (!wallet) {
    throw new ApiError(404, "DATABASE_ERROR", "No wallet is associated with this account.");
  }

  if (wallet.status === "ACTIVE" && wallet.raftlineAccountId) {
    const overview = await buildWalletOverview(wallet);
    if (overview.balanceUnavailableReason !== "ACCOUNT_NOT_FOUND") {
      return overview;
    }

    const marked = await prisma.wallet.updateMany({
      where: { id: wallet.id, status: "ACTIVE" },
      data: {
        status: "RECONCILIATION_REQUIRED",
        lastProvisioningError:
          "The ledger account linked to this wallet could not be found. Verification is required.",
      },
    });
    if (marked.count === 0) {
      const current = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      return buildWalletOverview(current);
    }

    await recordAudit({
      actorId: userId,
      action: AUDIT_ACTIONS.WALLET_RECONCILIATION_REQUIRED,
      entityType: "wallet",
      entityId: wallet.id,
      metadata: {
        reason: "ledger_account_missing",
        accountId: wallet.raftlineAccountId,
      },
    });

    wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  }

  const leaseCutoff = new Date(Date.now() - PROVISIONING_LEASE_MS);
  const claim = await prisma.wallet.updateMany({
    where: {
      id: wallet.id,
      OR: [
        {
          status: {
            in: ["PENDING", "FAILED", "RECONCILIATION_REQUIRED"],
          },
        },
        {
          status: "PROVISIONING",
          updatedAt: { lt: leaseCutoff },
        },
      ],
    },
    data: {
      status: "PROVISIONING",
      provisioningAttempts: { increment: 1 },
      lastProvisioningError: null,
    },
  });

  if (claim.count === 0) {
    const current = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    return buildWalletOverview(current);
  }

  const claimed = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.WALLET_PROVISIONING_STARTED,
    entityType: "wallet",
    entityId: claimed.id,
    metadata: { attempt: claimed.provisioningAttempts, currency: claimed.currency },
  });

  const accountId = walletAccountId(claimed);

  try {
    const result = await getRaftlineClient().ensureAccount({
      accountId,
      currency: claimed.currency,
      metadata: {
        source: "nexus-pay",
        walletId: claimed.id,
      },
    });

    const active = await prisma.wallet.update({
      where: { id: claimed.id },
      data: {
        status: "ACTIVE",
        raftlineAccountId: result.account.accountId,
        provisionedAt: new Date(),
        lastProvisioningError: null,
      },
    });

    await recordAudit({
      actorId: userId,
      action: AUDIT_ACTIONS.WALLET_PROVISIONED,
      entityType: "wallet",
      entityId: active.id,
      metadata: {
        accountId: result.account.accountId,
        mode: result.mode,
        created: result.created,
      },
    });

    return buildWalletOverview(active);
  } catch (error) {
    const ambiguous = error instanceof RaftlineError && error.ambiguous;
    const failedStatus = ambiguous ? "RECONCILIATION_REQUIRED" : "FAILED";
    const errorCode = error instanceof RaftlineError ? error.code : "INTERNAL";
    const safeMessage = ambiguous
      ? "Account creation could not be confirmed. Retry reconciliation before using the wallet."
      : "The wallet could not be set up. Please try again.";

    const failed = await prisma.wallet.update({
      where: { id: claimed.id },
      data: {
        status: failedStatus,
        lastProvisioningError: safeMessage,
      },
    });

    await recordAudit({
      actorId: userId,
      action: ambiguous
        ? AUDIT_ACTIONS.WALLET_RECONCILIATION_REQUIRED
        : AUDIT_ACTIONS.WALLET_PROVISIONING_FAILED,
      entityType: "wallet",
      entityId: failed.id,
      metadata: { errorCode, attempt: failed.provisioningAttempts },
    });

    return buildWalletOverview(failed);
  }
}
