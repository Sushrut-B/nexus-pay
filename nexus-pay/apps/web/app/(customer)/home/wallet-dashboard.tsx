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
import type { WalletOverview } from "@nexus/shared-types";
import {
  ArrowUpRight,
  CircleDollarSign,
  Clock3,
  Landmark,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { WalletStatusBadge, walletStatusLabel } from "@/components/wallet/status-badge";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";

export function WalletDashboard({
  displayName,
  initialOverview,
}: {
  displayName: string;
  initialOverview: WalletOverview | null;
}) {
  const queryClient = useQueryClient();
  const autoStarted = useRef(false);
  const queryKey = ["wallet-overview"] as const;

  const overviewQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<WalletOverview>("/api/wallet/status"),
    initialData: initialOverview ?? undefined,
    refetchInterval: (query) => {
      const status = query.state.data?.wallet.status;
      return status === "PENDING" || status === "PROVISIONING" ? 2000 : false;
    },
  });

  const provision = useMutation({
    mutationFn: () =>
      apiFetch<WalletOverview>("/api/wallet/provision", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
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
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const overview = overviewQuery.data;
  const status = overview?.wallet.status;
  const isWorking = status === "PENDING" || status === "PROVISIONING" || provision.isPending;
  const needsRetry = status === "FAILED" || status === "RECONCILIATION_REQUIRED";

  useEffect(() => {
    if (autoStarted.current) return;
    if (status === "PENDING") {
      autoStarted.current = true;
      provision.mutate();
    }
  }, [status, provision]);

  const balance = overview?.balance ?? null;
  const unavailableReason = overview?.balanceUnavailableReason ?? null;

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
            Your wallet, balance and account health in one place.
          </p>
        </div>
        {overview ? <WalletStatusBadge status={overview.wallet.status} /> : null}
      </div>

      {overviewQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>We couldn&apos;t refresh your wallet</AlertTitle>
          <AlertDescription>
            <p>
              {overviewQuery.error instanceof ApiClientError
                ? overviewQuery.error.message
                : "Check your connection and try again."}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {!overview ? (
        <Card>
          <CardHeader>
            <CardTitle>Your wallet is missing</CardTitle>
            <CardDescription>
              We could not find a wallet attached to this account. The account may need to be set
              up again by support.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-5">
            <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-primary"
              />
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
                </div>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent">
                  <WalletCards className="h-5 w-5 text-primary" aria-hidden="true" />
                </span>
              </div>

              <div className="mt-8 grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
                <Detail label="Account" value={maskAccount(overview.wallet.raftlineAccountId)} mono />
                <Detail label="Opened" value={formatDate(overview.wallet.provisionedAt)} />
                <Detail label="Source" value="Raftline ledger" />
              </div>
            </section>

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

            {status === "ACTIVE" &&
            (unavailableReason === "RAFTLINE_UNAVAILABLE" ||
              unavailableReason === "RAFTLINE_TIMEOUT") ? (
              <Alert variant="warning">
                <AlertTitle>Balance temporarily unavailable</AlertTitle>
                <AlertDescription>
                  <p>
                    Your wallet is active, but the ledger could not be reached just now. We have
                    not guessed a balance. Refresh shortly to try again.
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

            {status === "ACTIVE" && unavailableReason === "ACCOUNT_NOT_FOUND" ? (
              <Alert variant="destructive">
                <AlertTitle>Ledger account not found</AlertTitle>
                <AlertDescription>
                  <p>
                    Your wallet is marked active, but its ledger account could not be found.
                    Please retry verification so we can reconcile it safely.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => provision.mutate()}
                    disabled={provision.isPending}
                  >
                    Reconcile wallet
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Recent activity</CardTitle>
                  <CardDescription>Transactions will appear here.</CardDescription>
                </div>
                <Clock3 className="h-5 w-5 text-muted-foreground/60" aria-hidden="true" />
              </CardHeader>
              <CardContent>
                <div className="rounded-xl border border-dashed border-border bg-background/60 px-5 py-8 text-center">
                  <CircleDollarSign
                    className="mx-auto h-7 w-7 text-muted-foreground/50"
                    aria-hidden="true"
                  />
                  <p className="mt-3 text-sm font-medium text-foreground">No activity yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Your wallet is ready for the next release of Nexus Pay. Sending and receiving
                    money are not part of Release 1.
                  </p>
                </div>
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
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <WalletStatusBadge status={overview.wallet.status} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">Currency</span>
                  <span className="text-sm font-medium text-foreground">
                    {overview.wallet.currency}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">Ledger account</span>
                  <span
                    className="max-w-[180px] truncate font-mono text-xs font-medium text-foreground"
                    title={overview.wallet.raftlineAccountId ?? undefined}
                  >
                    {maskAccount(overview.wallet.raftlineAccountId)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">Setup</span>
                  <span className="text-sm font-medium text-foreground">
                    {overview.wallet.provisionedAt ? "Verified" : "In progress"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/15 bg-accent/40">
              <CardHeader>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-card">
                  <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                </span>
                <CardTitle className="pt-2 text-base">Protected by design</CardTitle>
                <CardDescription>
                  Your session is server-verified, and your balance is never copied into the app
                  database.
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
                  <p className="text-sm font-semibold text-foreground">One source of truth</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Your available balance is read from the Raftline ledger, with reserved funds
                    already accounted for.
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

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
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

function maskAccount(accountId: string | null): string {
  if (!accountId) return "Not assigned";
  if (accountId.length <= 14) return accountId;
  return `${accountId.slice(0, 8)}…${accountId.slice(-5)}`;
}
