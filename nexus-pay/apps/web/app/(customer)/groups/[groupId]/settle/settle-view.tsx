"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@nexus/ui";
import type { GroupDetail, SettlementView, SuggestedSettlement } from "@nexus/shared-types";
import { SETTLEMENT_STATUS_LABELS, formatMinorAsInput, parseMajorToMinor } from "@nexus/shared-types";
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatMoney, initials } from "@/lib/format";

export function SettleView({
  group,
  suggestions,
  initialPayeeId,
  initialAmountMinor,
  viewerId,
}: {
  group: GroupDetail;
  suggestions: SuggestedSettlement[];
  initialPayeeId: string;
  initialAmountMinor: number | null;
  viewerId: string;
}) {
  const candidates = suggestions.filter((suggestion) => suggestion.payer.userId === viewerId);
  const [payeeId, setPayeeId] = useState(
    initialPayeeId || candidates[0]?.payee.userId || "",
  );
  const [amount, setAmount] = useState(
    initialAmountMinor && initialAmountMinor > 0 ? formatMinorAsInput(initialAmountMinor) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SettlementView | null>(null);
  const clientRequestId = useRef<string | null>(null);

  const selected = candidates.find((suggestion) => suggestion.payee.userId === payeeId);
  const maxMinor = selected?.amountMinor ?? 0;
  const parsedAmount = parseMajorToMinor(amount);
  const amountLabel = parsedAmount.ok ? formatMoney(parsedAmount.amountMinor, "INR") : "the entered amount";

  const settle = useMutation({
    mutationFn: () => {
      const parsed = parseMajorToMinor(amount);
      if (!parsed.ok) throw new Error("Enter a valid amount with up to two decimal places.");
      if (parsed.amountMinor > maxMinor) {
        throw new Error(`You can settle at most ${formatMoney(maxMinor, "INR")} with ${selected?.payee.displayName}.`);
      }
      if (!clientRequestId.current) clientRequestId.current = crypto.randomUUID();
      return apiFetch<SettlementView>(`/api/groups/${encodeURIComponent(group.id)}/settlements`, {
        method: "POST",
        body: JSON.stringify({
          payeeUserId: payeeId,
          amountMinor: parsed.amountMinor,
          clientRequestId: clientRequestId.current,
        }),
      });
    },
    onSuccess: (settlement) => {
      setResult(settlement);
      setConfirming(false);
      setError(null);
      toast.success(
        settlement.status === "SETTLED" ? "Payment completed." : "Payment is being verified.",
      );
    },
    onError: (failure) => {
      setConfirming(false);
      setError(
        failure instanceof ApiClientError || failure instanceof Error
          ? failure.message
          : "Could not complete this settlement.",
      );
      if (failure instanceof ApiClientError && failure.status >= 500) {
        toast.warning("The outcome is unknown. Check the settlement again; do not pay twice.");
      }
    },
  });

  function retrySameRequest() {
    if (!clientRequestId.current) return;
    const parsed = parseMajorToMinor(amount);
    if (!parsed.ok) return;
    settle.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/groups/${encodeURIComponent(group.id)}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to group
        </Link>
      </Button>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Settle up</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Pay what you owe.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {group.name} · This uses the same verified Nexus Pay payment engine as Send Money.
        </p>
      </div>

      {result ? (
        <Card className="overflow-hidden">
          <div className={`h-1.5 w-full ${result.status === "SETTLED" ? "bg-emerald-500" : "bg-amber-500"}`} />
          <CardHeader className="items-center text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
            </span>
            <CardTitle className="pt-2 text-xl">
              {result.status === "SETTLED" ? "Settlement complete" : "Settlement needs confirmation"}
            </CardTitle>
            <CardDescription>
              {result.status === "SETTLED"
                ? "The ledger confirmed the transfer and your group balance has been updated."
                : "No success has been reported. The original request is preserved for reconciliation."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border bg-secondary/30 px-5 py-5 text-center">
              <p className="text-xs text-muted-foreground">Paid to {result.payee.displayName}</p>
              <p className="mt-1 font-display text-3xl font-semibold text-navy">
                {formatMoney(result.amountMinor, result.currency)}
              </p>
            </div>
            <div className="flex justify-center"><Badge variant={result.status === "SETTLED" ? "success" : "warning"}>{SETTLEMENT_STATUS_LABELS[result.status]}</Badge></div>
            {result.paymentRef ? (
              <p className="text-center text-xs text-muted-foreground">
                Reference:{" "}
                <Link href={`/transactions/${encodeURIComponent(result.paymentRef!)}`} className="font-mono text-primary underline-offset-4 hover:underline">
                  {result.paymentRef}
                </Link>
              </p>
            ) : null}
            {result.status !== "SETTLED" ? (
              <Button className="w-full" onClick={retrySameRequest} disabled={settle.isPending}>
                Check the same payment again
              </Button>
            ) : null}
            <Button asChild variant="outline" className="w-full">
              <Link href={`/groups/${encodeURIComponent(group.id)}`}>Back to group</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review your settlement</CardTitle>
            <CardDescription>
              Partial payments are supported. Only a confirmed payment reduces what you owe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {candidates.length === 0 ? (
              <Alert variant="warning">
                <AlertTitle>Nothing to settle</AlertTitle>
                <AlertDescription>
                  There are no suggested payments for you in this group right now.
                </AlertDescription>
              </Alert>
            ) : null}

            <div>
              <Label htmlFor="settle-payee">Pay to</Label>
              <select
                id="settle-payee"
                value={payeeId}
                onChange={(event) => {
                  setPayeeId(event.target.value);
                  setAmount("");
                }}
                className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                {candidates.map((suggestion) => (
                  <option key={suggestion.payee.userId} value={suggestion.payee.userId}>
                    {suggestion.payee.displayName} — owes {formatMoney(suggestion.amountMinor, "INR")}
                  </option>
                ))}
              </select>
            </div>

            {selected ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-sm font-semibold text-white">
                  {initials(selected.payee.displayName)}
                </span>
                <div>
                  <p className="text-sm font-semibold">{selected.payee.displayName}</p>
                  <p className="text-xs text-muted-foreground">@{selected.payee.username}</p>
                </div>
                <p className="ml-auto text-xs font-medium text-muted-foreground">
                  Max {formatMoney(selected.amountMinor, "INR")}
                </p>
              </div>
            ) : null}

            <div>
              <Label htmlFor="settle-amount">Amount (INR)</Label>
              <Input
                id="settle-amount"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError(null);
                }}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1.5 h-12 text-lg font-semibold tabular-nums"
              />
              {selected ? (
                <Button
                  variant="link"
                  size="sm"
                  className="-ml-2 mt-1"
                  onClick={() => setAmount(formatMinorAsInput(selected.amountMinor))}
                >
                  Use full amount
                </Button>
              ) : null}
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-accent/40 px-4 py-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p>
                We reserve one durable payment reference for this settlement. If you refresh or retry,
                the original payment is recovered — you will not be debited twice.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="outline" className="sm:flex-1">
                <Link href={`/groups/${encodeURIComponent(group.id)}`}>Not now</Link>
              </Button>
              <Button
                className="sm:flex-[2]"
                disabled={!payeeId || candidates.length === 0 || settle.isPending}
                onClick={() => setConfirming(true)}
              >
                Review payment
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {confirming && selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">Confirm and pay</CardTitle>
              <CardDescription>
                {amountLabel} to {selected.payee.displayName} (@{selected.payee.username}) in {group.name}.
                Raftline must confirm before dues are reduced.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Back</Button>
              <Button className="flex-1" disabled={settle.isPending} onClick={() => settle.mutate()}>
                {settle.isPending ? "Confirming…" : "Confirm payment"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
