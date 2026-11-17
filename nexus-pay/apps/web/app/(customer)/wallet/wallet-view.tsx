"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@nexus/ui";
import type {
  FundingView,
  TransactionSummary,
  WalletListResult,
  WalletOverview,
} from "@nexus/shared-types";
import {
  ArrowRight,
  FlaskConical,
  Landmark,
  Plus,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { TransactionRow } from "@/components/payments/transaction-row";
import { WalletStatusBadge, walletStatusLabel } from "@/components/wallet/status-badge";
import { apiFetch } from "@/lib/api/client";
import { formatDate, formatDateTime, formatMoney, maskAccountId } from "@/lib/format";

export function WalletView({
  initialWallets,
  fundingHistory,
  recentActivity,
}: {
  initialWallets: WalletListResult;
  fundingHistory: FundingView[];
  recentActivity: TransactionSummary[];
}) {
  const walletsQuery = useQuery({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<WalletListResult>("/api/wallets"),
    initialData: initialWallets,
  });

  const wallets = walletsQuery.data?.wallets ?? initialWallets.wallets;
  const primary = wallets[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Wallet</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Your money, clearly held.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Balances are read live from the Raftline ledger. Nothing on this page is a cached
            estimate.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void walletsQuery.refetch()}
          disabled={walletsQuery.isFetching}
        >
          <RefreshCw
            className={`h-4 w-4 ${walletsQuery.isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh balances
        </Button>
      </div>

      {wallets.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No wallet yet</CardTitle>
            <CardDescription>
              This account does not have a wallet attached. Return to the overview to start wallet
              setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/home">Go to overview</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
          <div className="space-y-5">
            {wallets.map((overview, index) => (
              <WalletCard key={overview.wallet.id} overview={overview} primary={index === 0} />
            ))}

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Recent wallet activity</CardTitle>
                  <CardDescription>The latest recorded credits and debits.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/transactions">
                    View all
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {recentActivity.length > 0 ? (
                  <div className="divide-y divide-border/70">
                    {recentActivity.map((transaction) => (
                      <TransactionRow key={transaction.id} transaction={transaction} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    No wallet activity has been recorded yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Add simulated funds</CardTitle>
                <CardDescription>
                  Sandbox money only. No bank, UPI or real funds are involved.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full" disabled={primary?.wallet.status !== "ACTIVE"}>
                  <Link href="/wallet/add-money">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add money
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funding history</CardTitle>
                <CardDescription>Simulated sandbox credits for this wallet.</CardDescription>
              </CardHeader>
              <CardContent>
                {fundingHistory.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center">
                    <FlaskConical
                      className="mx-auto h-6 w-6 text-muted-foreground/50"
                      aria-hidden="true"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      No simulated funding yet.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {fundingHistory.map((funding) => (
                      <li key={funding.id} className="rounded-xl border border-border/70 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">
                              {formatMoney(funding.amountMinor, funding.currency)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {formatDateTime(funding.completedAt ?? funding.createdAt)}
                            </p>
                          </div>
                          <FundingStatus funding={funding} />
                        </div>
                        {funding.transaction ? (
                          <Link
                            href={`/transactions/${encodeURIComponent(
                              funding.fundingRef ?? funding.transaction.id,
                            )}`}
                            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary underline-offset-4 hover:underline"
                          >
                            Open receipt
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {primary ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Wallet record</CardTitle>
                  <CardDescription>Application metadata, not a balance ledger.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <MetaRow label="Created" value={formatDate(primary.wallet.createdAt)} />
                  <MetaRow
                    label="Provisioned"
                    value={primary.wallet.provisionedAt ? formatDate(primary.wallet.provisionedAt) : "Pending"}
                  />
                  <MetaRow label="Type" value="Customer wallet" />
                  <MetaRow label="Currency" value={primary.wallet.currency} />
                  <MetaRow label="Ledger" value="Raftline replicated state machine" />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function WalletCard({ overview, primary }: { overview: WalletOverview; primary: boolean }) {
  const { wallet, balance } = overview;
  return (
    <Card className="overflow-hidden">
      <div className="h-1 w-full bg-primary/70" />
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">
              {primary ? "Primary wallet" : `${wallet.currency} wallet`}
            </CardTitle>
            <WalletStatusBadge status={wallet.status} />
          </div>
          <CardDescription className="mt-1">
            {wallet.currency} · {walletStatusLabel(wallet.status)} ·{" "}
            {maskAccountId(wallet.raftlineAccountId)}
          </CardDescription>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent">
          <WalletCards className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        {wallet.status !== "ACTIVE" ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            A balance will appear when this wallet is active and verified.
          </p>
        ) : balance ? (
          <>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Available balance
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tracking-[-0.04em] text-navy">
                {formatMoney(balance.availableMinor, balance.currency)}
              </p>
            </div>
            <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Reserved
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {formatMoney(balance.reservedMinor, balance.currency)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Ledger total
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {formatMoney(balance.ledgerBalanceMinor, balance.currency)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Last read
                </p>
                <p className="mt-1 text-xs font-medium">
                  {formatDateTime(balance.fetchedAt)}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <Spinner className="h-4 w-4" />
            Balance unavailable. We have not guessed a value.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/wallet/add-money">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add money
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/transactions?filter=RECEIVED">
              <Landmark className="h-4 w-4" aria-hidden="true" />
              Funding activity
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FundingStatus({ funding }: { funding: FundingView }) {
  const tone =
    funding.transactionStatus === "SUCCESSFUL"
      ? "bg-emerald-50 text-emerald-700"
      : funding.transactionStatus === "FAILED"
        ? "bg-red-50 text-red-700"
        : funding.transactionStatus === "RECONCILIATION_REQUIRED"
          ? "bg-amber-50 text-amber-700"
          : "bg-blue-50 text-blue-700";
  const label =
    funding.transactionStatus === "SUCCESSFUL"
      ? "Successful"
      : funding.transactionStatus === "FAILED"
        ? "Failed"
        : funding.transactionStatus === "RECONCILIATION_REQUIRED"
          ? "Verification"
          : "Processing";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
