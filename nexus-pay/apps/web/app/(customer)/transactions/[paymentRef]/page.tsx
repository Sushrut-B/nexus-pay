import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
} from "@nexus/ui";
import type { TransactionDetail } from "@nexus/shared-types";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Info,
  Landmark,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { CopyButton } from "@/components/payments/copy-button";
import { SimulationNotice } from "@/components/payments/simulation-notice";
import { TransactionStatusBadge } from "@/components/payments/status-badge";
import { ApiError } from "@/lib/api/response";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getTransactionDetail } from "@/lib/payments/transaction-service";

export const metadata: Metadata = {
  title: "Transaction detail",
};

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ paymentRef: string }>;
}) {
  const { paymentRef } = await params;
  const auth = await requireOnboardedUser(`/transactions/${paymentRef}`);

  let detail: TransactionDetail;
  try {
    detail = await getTransactionDetail(auth.user.id, paymentRef);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const { transaction } = detail;
  const incoming = transaction.direction === "RECEIVED";
  const successful = transaction.status === "SUCCESSFUL";
  const unresolved = transaction.status === "PROCESSING" || transaction.status === "RECONCILIATION_REQUIRED";
  const kindLabel =
    transaction.kind === "FUNDING"
      ? "Simulated sandbox funding"
      : incoming
        ? "Payment received"
        : "Payment sent";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/transactions">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All transactions
          </Link>
        </Button>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              {kindLabel}
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
              {incoming ? "+" : "−"}
              {formatMoney(transaction.amountMinor, transaction.currency)}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatDateTime(transaction.occurredAt)}
            </p>
          </div>
          <TransactionStatusBadge status={transaction.status} />
        </div>
      </div>

      {transaction.kind === "FUNDING" ? <SimulationNotice /> : null}

      {unresolved ? (
        <Alert variant="warning">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>This outcome is not final</AlertTitle>
          <AlertDescription>
            The ledger has not produced a verified settlement receipt for this transaction. No
            success is being reported, and the original request is preserved for reconciliation.
          </AlertDescription>
        </Alert>
      ) : null}

      {transaction.status === "FAILED" ? (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>This transaction did not go through</AlertTitle>
          <AlertDescription>
            The ledger rejected it. No money was moved. You can safely start a new payment if you
            still want to proceed.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
              <CardDescription>
                Values shown here come from the verified application record and the Raftline
                ledger reference.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Reference
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded-lg border border-border/70 bg-secondary/40 px-2.5 py-1.5 font-mono text-xs">
                    {detail.reference}
                  </code>
                  <CopyButton value={detail.reference} label="Copy reference" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Rail" value={detail.rail === "SIMULATED_FUNDING" ? "Sandbox reserve credit" : "INTERNAL_BOOK"} />
                <Field label="Currency" value={transaction.currency} />
                <Field
                  label="Direction"
                  value={
                    transaction.kind === "FUNDING"
                      ? "Credit"
                      : incoming
                        ? "Received"
                        : "Sent"
                  }
                />
                <Field
                  label="Ledger verified"
                  value={successful ? "Yes" : unresolved ? "Pending" : "No"}
                />
                <Field label="Note" value={transaction.description ?? "No note"} wide />
                {transaction.paymentRef ? (
                  <Field label="Ledger reference" value={transaction.paymentRef} mono wide />
                ) : null}
              </div>

              {detail.idempotentReplay ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-xs text-blue-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>
                    The ledger returned the original result for this request. It was recorded once
                    and not applied twice.
                  </p>
                </div>
              ) : null}

              {successful ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button asChild>
                    <a href={`/api/transactions/${encodeURIComponent(detail.reference)}/receipt`}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download PDF receipt
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={incoming ? "/transactions?filter=RECEIVED" : "/transactions?filter=SENT"}>
                      {incoming ? "View received" : "View sent"}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>Durable milestones for this transaction.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {detail.timeline.map((entry, index) => (
                  <li key={`${entry.label}-${index}`} className="flex gap-3">
                    <span
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                        entry.complete
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {entry.complete ? (
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{entry.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {entry.at ? formatDateTime(entry.at) : "Not recorded"}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Parties</CardTitle>
              <CardDescription>Sender and recipient of this entry.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Party label="From" party={detail.parties.sender} />
              <div className="flex justify-center text-muted-foreground">
                <ArrowRight className="h-4 w-4 rotate-90" aria-hidden="true" />
              </div>
              <Party label="To" party={detail.parties.recipient} />
            </CardContent>
          </Card>

          <Card className="border-primary/15 bg-accent/40">
            <CardContent className="flex items-start gap-3 p-5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-foreground">Financial integrity</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Success is shown only after a committed Raftline receipt is verified. If the
                  outcome is unknown, this page keeps it unresolved rather than guessing.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-start gap-3 p-5">
              <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-foreground">Ledger-backed</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Balances and settlement outcomes are read from the Raftline replicated state
                  machine, not calculated by Nexus Pay.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 break-all text-sm font-medium text-foreground ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Party({
  label,
  party,
}: {
  label: string;
  party: TransactionDetail["parties"]["sender"];
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">{party.displayName}</p>
      <p className="text-xs text-muted-foreground">
        {party.kind === "SIMULATED_RESERVE"
          ? "Simulated sandbox reserve"
          : party.username
            ? `@${party.username}`
            : "Nexus Pay customer"}
      </p>
    </div>
  );
}
