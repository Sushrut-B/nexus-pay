"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@nexus/ui";
import type {
  MonthlySummary,
  TransactionListResult,
  TransactionSummary,
  WalletOverview,
} from "@nexus/shared-types";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Landmark,
  ListFilter,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { TransactionRow } from "@/components/payments/transaction-row";
import { WalletStatusBadge, walletStatusLabel } from "@/components/wallet/status-badge";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, formatDateTime, formatMoney, maskAccountId } from "@/lib/format";

export function WalletDashboard({
  displayName,
  initialOverview,
  initialTransactions,
  monthlySummary,
  unresolvedPayments,
  unresolvedFunding,
}: {
  displayName: string;
  initialOverview: WalletOverview | null;
  initialTransactions: TransactionSummary[];
  monthlySummary: MonthlySummary;
  unresolvedPayments: number;
  unresolvedFunding: number;
}) {
  const queryClient = useQueryClient();
  const autoStarted = useRef(false);
  const overviewKey = ["wallet-overview"] as const;

  const overviewQuery = useQuery({
    queryKey: overviewKey,
    queryFn: () => apiFetch<WalletOverview>("/api/wallet/status"),
    initialData: initialOverview ?? undefined,
    refetchInterval: (query) => {
      const status = query.state.data?.wallet.status;
      if (status === "PENDING" || status === "PROVISIONING") return 2000;
      if (query.state.data?.balanceUnavailableReason) return 15000;
      return false;
    },
  });

  const transactionsQuery = useQuery({
    queryKey: ["transactions", "recent"],
    queryFn: () => apiFetch<TransactionListResult>("/api/payments?pageSize=5"),
    initialData: {
      items: initialTransactions,
      page: 1,
      pageSize: 5,
      total: initialTransactions.length,
      totalPages: 1,
      filter: "ALL" as const,
      sort: "newest" as const,
      search: null,
      from: null,
      to: null,
    },
  });

  const provision = useMutation({
    mutationFn: () =>
      apiFetch<WalletOverview>("/api/wallet/provision", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(overviewKey, data);
      if (data.wallet.status === "FAILED" || data.wallet.status === "RECONCILIATION_REQUIRED") {
        toast.error(data.wallet.lastProvisioningError ?? "Wallet setup needs attention.");
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "We could not start wallet setup. Please try again.",
      );
      void queryClient.invalidateQueries({ queryKey: overviewKey });
    },
  });

  const overview = overviewQuery.data;
  const status = overview?.wallet.status;
  const isWorking = status === "PENDING" || status === "PROVISIONING" || provision.isPending;
  const needsRetry = status === "FAILED" || status === "RECONCILIATION_REQUIRED";
  const active = status === "ACTIVE";
  const balance = overview?.balance ?? null;
  const unavailableReason = overview?.balanceUnavailableReason ?? null;
  const transactions = transactionsQuery.data?.items ?? initialTransactions;
  const unresolvedTotal = unresolvedPayments + unresolvedFunding;

  useEffect(() => {
    if (autoStarted.current) return;
    if (status === "PENDING") {
      autoStarted.current = true;
      provision.mutate();
    }
  }, [status, provision]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Your overview
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Good to see you, {displayName}.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your INR wallet, recent activity and next steps.
          </p>
        </div>
        {overview ? <WalletStatusBadge status={overview.wallet.status} /> : null}
      </div>

      {overviewQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>We couldn&apos;t refresh your wallet</AlertTitle>
          <AlertDescription>
            {overviewQuery.error instanceof ApiClientError
              ? overviewQuery.error.message
              : "Check your connection and try again."}
          </AlertDescription>
        </Alert>
      ) : null}

      {!overview ? (
        <Card>
          <CardHeader>
            <CardTitle>Your wallet is missing</CardTitle>
            <CardDescription>
              We could not find a wallet attached to this account. Contact support so the account
              can be set up safely.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-5">
            <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary" />
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Available balance
                  </p>
                  <div className="mt-3 flex min-h-[52px] items-center">
                    {isWorking ? (
                      <span className="inline-flex items-center gap-3 text-sm text-muted-foreground">
                        <Spinner />
                        {status === "PENDING"
                          ? "Preparing your wallet…"
                          : "Setting up your ledger account…"}
                      </span>
                    ) : balance ? (
                      <p className="font-display text-[2.6rem] font-semibold leading-none tracking-[-0.045em] text-navy sm:text-5xl">
                        {formatMoney(balance.amountMinor, balance.currency)}
                      </p>
                    ) : (
                      <p className="font-display text-[2.6rem] font-semibold leading-none tracking-[-0.045em] text-muted-foreground/50 sm:text-5xl">
                        —
                      </p>
                    )}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {overview.wallet.currency} wallet · {walletStatusLabel(overview.wallet.status)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {balance
                      ? `Read from the Raftline ledger at ${formatDateTime(balance.fetchedAt)}.`
                      : "No balance is shown without a verified ledger response."}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent">
                    <WalletCards className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void overviewQuery.refetch()}
                    disabled={overviewQuery.isFetching}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${overviewQuery.isFetching ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="mt-7 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {active ? (
                  <>
                    <Button asChild>
                      <Link href="/send">
                        <Send className="h-4 w-4" aria-hidden="true" />
                        Send
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/wallet/add-money">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add money
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/receive">
                        <QrCode className="h-4 w-4" aria-hidden="true" />
                        Receive
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/transactions">
                        <ListFilter className="h-4 w-4" aria-hidden="true" />
                        Transactions
                      </Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button disabled>
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Send
                    </Button>
                    <Button disabled variant="outline">
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add money
                    </Button>
                    <Button disabled variant="outline">
                      <QrCode className="h-4 w-4" aria-hidden="true" />
                      Receive
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/transactions">
                        <ListFilter className="h-4 w-4" aria-hidden="true" />
                        Transactions
                      </Link>
                    </Button>
                  </>
                )}
              </div>

              <div className="mt-6 grid gap-3 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Account" value={maskAccountId(overview.wallet.raftlineAccountId)} mono />
                <Detail
                  label="Reserved"
                  value={
                    balance
                      ? formatMoney(balance.reservedMinor, balance.currency)
                      : "Unavailable"
                  }
                />
                <Detail label="Opened" value={formatDate(overview.wallet.provisionedAt)} />
                <Detail label="Source" value="Raftline ledger" />
              </div>
            </section>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">This month</CardTitle>
                  <CardDescription>Based on recorded transaction outcomes.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <Stat
                  label="Money sent"
                  value={formatMoney(monthlySummary.sentMinor, monthlySummary.currency)}
                  tone="sent"
                />
                <Stat
                  label="Money received"
                  value={formatMoney(monthlySummary.receivedMinor, monthlySummary.currency)}
                  tone="received"
                />
                <Stat
                  label="Transactions"
                  value={String(monthlySummary.transactionCount)}
                  tone="neutral"
                />
              </CardContent>
            </Card>

            {unresolvedTotal > 0 ? (
              <Alert variant="warning">
                <AlertTitle>Ledger confirmation needed</AlertTitle>
                <AlertDescription>
                  <p>
                    {unresolvedTotal === 1
                      ? "One recent payment or funding request is still awaiting a verified ledger outcome."
                      : `${unresolvedTotal} recent requests are still awaiting verified ledger outcomes.`}{" "}
                    New payments are blocked until they are reconciled.
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <Link href="/transactions?filter=PROCESSING">
                      Review pending activity
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {needsRetry ? (
              <Alert variant={status === "RECONCILIATION_REQUIRED" ? "warning" : "destructive"}>
                <AlertTitle>
                  {status === "RECONCILIATION_REQUIRED"
                    ? "Verification needed"
                    : "Wallet setup needs attention"}
                </AlertTitle>
                <AlertDescription>
                  <p>
                    {overview.wallet.lastProvisioningError ??
                      "We could not confirm the last setup attempt. No balance is shown until the account is verified."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => provision.mutate()}
                    disabled={provision.isPending}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${provision.isPending ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    {status === "RECONCILIATION_REQUIRED"
                      ? "Retry verification"
                      : "Retry wallet setup"}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {active &&
            (unavailableReason === "RAFTLINE_UNAVAILABLE" ||
              unavailableReason === "RAFTLINE_TIMEOUT") ? (
              <Alert variant="warning">
                <AlertTitle>Balance temporarily unavailable</AlertTitle>
                <AlertDescription>
                  <p>
                    Your wallet is active, but the ledger could not be reached just now. We have
                    not guessed a balance.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void overviewQuery.refetch()}
                    disabled={overviewQuery.isFetching}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${overviewQuery.isFetching ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    Refresh balance
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Recent activity</CardTitle>
                  <CardDescription>Payments and simulated sandbox credits.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/transactions">
                    View all
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {transactions.length > 0 ? (
                  <div className="divide-y divide-border/70">
                    {transactions.map((transaction) => (
                      <TransactionRow key={transaction.id} transaction={transaction} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-background/60 px-5 py-10 text-center">
                    <ArrowDownLeft
                      className="mx-auto h-7 w-7 text-muted-foreground/50"
                      aria-hidden="true"
                    />
                    <p className="mt-3 text-sm font-medium text-foreground">No activity yet</p>
                    <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                      Add simulated sandbox funds to try the wallet, or send money to another Nexus
                      Pay customer.
                    </p>
                    {active ? (
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        <Button asChild size="sm">
                          <Link href="/wallet/add-money">Add money</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link href="/send">Send money</Link>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Wallet details</CardTitle>
                <CardDescription>The essentials, at a glance.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Row label="Status" value={<WalletStatusBadge status={overview.wallet.status} />} />
                <Row
                  label="Currency"
                  value={<span className="text-sm font-medium">{overview.wallet.currency}</span>}
                />
                <Row
                  label="Ledger account"
                  value={
                    <span className="font-mono text-xs font-medium">
                      {maskAccountId(overview.wallet.raftlineAccountId)}
                    </span>
                  }
                />
                <Row
                  label="Setup"
                  value={
                    <span className="text-sm font-medium">
                      {overview.wallet.provisionedAt ? "Verified" : "In progress"}
                    </span>
                  }
                />
                <Button asChild variant="outline" className="w-full">
                  <Link href="/wallet">
                    Open wallet
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-primary/15 bg-accent/40">
              <CardHeader>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-card">
                  <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                </span>
                <CardTitle className="pt-2 text-base">Protected by design</CardTitle>
                <CardDescription>
                  Balances come from Raftline. A payment is only shown as successful after a
                  committed ledger receipt is verified.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href="/profile"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Review your account
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start gap-3 p-5">
                <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Sandbox only</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Simulated funding is test money. No bank, UPI, card or real-world funds are
                    involved.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 truncate text-sm font-medium text-foreground ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "sent" | "received" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "received"
            ? "text-emerald-700"
            : tone === "sent"
              ? "text-foreground"
              : "text-navy"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
