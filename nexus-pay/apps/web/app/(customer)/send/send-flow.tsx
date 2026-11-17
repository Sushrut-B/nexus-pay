"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
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
import type {
  MonthlySummary,
  PaymentView,
  RecentRecipient,
  RecipientSummary,
  WalletOverview,
} from "@nexus/shared-types";
import {
  MAX_PAYMENT_DESCRIPTION_LENGTH,
  MAX_PAYMENT_MINOR,
  majorToMinor,
  parseMajorToMinor,
} from "@nexus/shared-types";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Search,
  Send,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { SimulationNotice } from "@/components/payments/simulation-notice";
import { StepIndicator } from "@/components/payments/step-indicator";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatMoney, maskAccountId } from "@/lib/format";

const QUICK_AMOUNTS = [500, 1000, 1500, 2000];
const PENDING_KEY = "nexuspay.payment.pending";

interface PendingPayment {
  clientRequestId: string;
  createdAt: string;
}

function readPending(): PendingPayment | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingPayment;
    return typeof value.clientRequestId === "string" ? value : null;
  } catch {
    return null;
  }
}

function writePending(value: PendingPayment | null): void {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(PENDING_KEY, JSON.stringify(value));
  else window.localStorage.removeItem(PENDING_KEY);
}

export function SendFlow({
  overview,
  recentRecipients,
  initialRecipient,
  monthlySummary,
  prefillNotice = null,
}: {
  overview: WalletOverview | null;
  recentRecipients: RecentRecipient[];
  initialRecipient: RecipientSummary | null;
  monthlySummary: MonthlySummary;
  prefillNotice?: string | null;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(initialRecipient ? 1 : 0);
  const [query, setQuery] = useState(initialRecipient?.username ?? "");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<RecipientSummary | null>(initialRecipient);
  const [amountInput, setAmountInput] = useState("");
  const [description, setDescription] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storedPending, setStoredPending] = useState<PendingPayment | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const wallet = overview?.wallet ?? null;
  const balance = overview?.balance ?? null;
  const active = wallet?.status === "ACTIVE" && Boolean(wallet?.raftlineAccountId);
  const parsed = parseMajorToMinor(amountInput, MAX_PAYMENT_MINOR);
  const amountMinor = parsed.ok ? parsed.amountMinor : null;
  const exceedsBalance =
    balance !== null && amountMinor !== null && amountMinor > balance.availableMinor;

  const applyPayment = useCallback(
    (result: PaymentView) => {
      setPayment(result);
      setStep(3);
      setError(null);
      if (result.status === "SETTLED" || result.status === "REJECTED") {
        requestIdRef.current = null;
        setStoredPending(null);
        writePending(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["wallet-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["wallets"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    [queryClient],
  );

  const recover = useCallback(
    async (clientRequestId: string, silent = false) => {
      setRecovering(true);
      try {
        const result = await apiFetch<PaymentView>(
          `/api/payments/recovery?clientRequestId=${encodeURIComponent(clientRequestId)}`,
        );
        if (result.status === "SETTLED" || result.status === "REJECTED") {
          applyPayment(result);
        } else if (!silent) {
          applyPayment(result);
        }
      } catch (recoveryError) {
        if (!silent) {
          setError(
            recoveryError instanceof ApiClientError
              ? recoveryError.message
              : "The payment outcome could not be checked yet. No new payment was submitted.",
          );
        }
      } finally {
        setRecovering(false);
      }
    },
    [applyPayment],
  );

  useEffect(() => {
    const stored = readPending();
    if (!stored) return;
    setStoredPending(stored);
    requestIdRef.current = stored.clientRequestId;
    void recover(stored.clientRequestId, true);
  }, [recover]);

  async function search(value: string) {
    const term = value.trim();
    if (term.length < 3) {
      setSearchError("Enter at least 3 characters.");
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const result = await apiFetch<RecipientSummary>(
        `/api/recipients/search?q=${encodeURIComponent(term)}`,
      );
      setRecipient(result);
      setStep(1);
      setPayment(null);
      setError(null);
    } catch (searchFailure) {
      setRecipient(null);
      setSearchError(
        searchFailure instanceof ApiClientError
          ? searchFailure.message
          : "We could not search for that recipient. Try again.",
      );
    } finally {
      setSearching(false);
    }
  }

  function review() {
    if (!active) {
      setFieldError("Your wallet must be active before you can send money.");
      return;
    }
    if (!recipient) {
      setStep(0);
      return;
    }
    if (!parsed.ok) {
      setFieldError(
        parsed.reason === "NON_POSITIVE"
          ? "Enter an amount greater than zero."
          : parsed.reason === "TOO_LARGE"
            ? `The maximum payment amount is ${formatMoney(MAX_PAYMENT_MINOR, "INR")}.`
            : "Enter a valid amount with up to two decimal places.",
      );
      return;
    }
    setFieldError(null);
    setStep(2);
  }

  async function submit() {
    if (!recipient || !amountMinor) return;
    setPending(true);
    setError(null);
    const clientRequestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    const pendingValue: PendingPayment = {
      clientRequestId,
      createdAt: new Date().toISOString(),
    };
    setStoredPending(pendingValue);
    writePending(pendingValue);

    try {
      const result = await apiFetch<PaymentView>("/api/payments/send", {
        method: "POST",
        body: JSON.stringify({
          clientRequestId,
          recipientToken: recipient.recipientToken,
          amountMinor,
          description: description.trim() ? description.trim() : undefined,
        }),
      });
      applyPayment(result);
    } catch (submitError) {
      if (submitError instanceof ApiClientError) {
        setError(submitError.message);
        if (submitError.status < 500 && submitError.status !== 408 && submitError.status !== 409) {
          requestIdRef.current = null;
          setStoredPending(null);
          writePending(null);
        }
      } else {
        setError(
          "We could not confirm this payment. It may still be committed. Check its status before attempting another payment.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setStep(0);
    setRecipient(null);
    setQuery("");
    setAmountInput("");
    setDescription("");
    setPayment(null);
    setError(null);
    setFieldError(null);
    setSearchError(null);
    requestIdRef.current = null;
    setStoredPending(null);
    writePending(null);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Send money</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Send to another customer
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a verified Nexus Pay customer, review the details, then confirm. Only a committed
          Raftline receipt is shown as success.
        </p>
      </div>

      {prefillNotice ? (
        <Alert variant="warning">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Payment link could not be applied</AlertTitle>
          <AlertDescription>{prefillNotice}</AlertDescription>
        </Alert>
      ) : null}

      <StepIndicator steps={["Recipient", "Amount", "Review", "Result"]} current={step} />

      {storedPending && step !== 3 ? (
        <Alert variant="warning">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>A previous payment is awaiting confirmation</AlertTitle>
          <AlertDescription>
            <p>
              This device started a payment that has not received a verified outcome. Do not start a
              new transfer; check the original payment first.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => void recover(storedPending.clientRequestId)}
                disabled={recovering}
              >
                <ShieldCheck className={`h-4 w-4 ${recovering ? "animate-spin" : ""}`} aria-hidden="true" />
                Check original payment
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/transactions?filter=PROCESSING">Open pending activity</Link>
              </Button>
            </div>
            {error ? <p className="mt-2 text-xs">{error}</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who are you paying?</CardTitle>
            <CardDescription>
              Search by exact Nexus username, registered email address or mobile number.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void search(query);
              }}
            >
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  aria-label="Recipient username, email address or mobile number"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="@username, email or mobile"
                  className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3.5 text-sm shadow-xs outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={searching}>
                <Search className="h-4 w-4" aria-hidden="true" />
                {searching ? "Searching…" : "Find recipient"}
              </Button>
            </form>

            {searchError ? (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertDescription>{searchError}</AlertDescription>
              </Alert>
            ) : null}

            {recentRecipients.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Recent recipients
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {recentRecipients.map((person) => (
                    <button
                      key={person.username}
                      type="button"
                      onClick={() => void search(person.username)}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-sm font-semibold text-navy">
                        {person.displayName.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {person.displayName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{person.username}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
              We only return a display name and username, never ledger account identifiers or
              private contact details. Search is rate limited to prevent enumeration.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 1 && recipient ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How much are you sending?</CardTitle>
            <CardDescription>
              Available balance:{" "}
              {balance ? formatMoney(balance.availableMinor, balance.currency) : "unavailable"} ·
              This month you have sent{" "}
              {formatMoney(monthlySummary.sentMinor, monthlySummary.currency)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-emerald-700">
                <UserRound className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-emerald-950">
                  {recipient.displayName}
                </p>
                <p className="truncate text-xs text-emerald-800">@{recipient.username}</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Verified
              </span>
            </div>

            <div>
              <label htmlFor="send-amount" className="text-sm font-medium text-foreground">
                Amount (INR)
              </label>
              <div className="mt-2 flex items-center rounded-xl border border-input bg-background px-4 focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/10">
                <span className="text-lg font-semibold text-muted-foreground">₹</span>
                <input
                  id="send-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.target.value);
                    setFieldError(null);
                  }}
                  aria-invalid={Boolean(fieldError)}
                  className="h-14 w-full border-0 bg-transparent px-3 text-2xl font-semibold tabular-nums text-navy outline-none placeholder:text-muted-foreground/40"
                />
              </div>
              {fieldError ? (
                <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                  {fieldError}
                </p>
              ) : exceedsBalance ? (
                <p className="mt-1.5 text-xs font-medium text-amber-700">
                  This is more than your available balance. The ledger will make the final decision.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Minimum ₹1.00 · Maximum ₹1,00,000.00.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  size="sm"
                  variant={amountInput === String(amount) ? "default" : "outline"}
                  onClick={() => {
                    setAmountInput(String(amount));
                    setFieldError(null);
                  }}
                >
                  {formatMoney(majorToMinor(amount), "INR")}
                </Button>
              ))}
            </div>

            <div>
              <label htmlFor="send-description" className="text-sm font-medium text-foreground">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="send-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={MAX_PAYMENT_DESCRIPTION_LENGTH}
                placeholder="What is this payment for?"
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10"
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">
                {description.length}/{MAX_PAYMENT_DESCRIPTION_LENGTH}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="sm:flex-1" onClick={() => setStep(0)}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Change recipient
              </Button>
              <Button className="sm:flex-[2]" onClick={review}>
                Review payment
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 && recipient && amountMinor ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review your payment</CardTitle>
            <CardDescription>Nothing is sent until you confirm.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl border border-border bg-secondary/30 px-5 py-6 text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                You are sending
              </p>
              <p className="mt-2 font-display text-4xl font-semibold tracking-[-0.04em] text-navy">
                {formatMoney(amountMinor, "INR")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">to {recipient.displayName}</p>
            </div>

            <dl className="space-y-3 text-sm">
              <ReviewRow label="Recipient" value={`${recipient.displayName} (@${recipient.username})`} />
              <ReviewRow label="From wallet" value={wallet ? maskAccountId(wallet.raftlineAccountId) : "—"} />
              <ReviewRow label="Amount" value={formatMoney(amountMinor, "INR")} />
              <ReviewRow label="Fee" value="None" />
              <ReviewRow label="Total payable" value={formatMoney(amountMinor, "INR")} />
              <ReviewRow label="Note" value={description.trim() || "No note"} />
              <ReviewRow label="Payment rail" value="INTERNAL_BOOK (Nexus Pay only)" />
            </dl>

            <SimulationNotice compact />

            {error ? (
              <Alert variant="warning">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Payment needs confirmation</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="sm:flex-1"
                onClick={() => setStep(1)}
                disabled={pending}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </Button>
              <Button className="sm:flex-[2]" onClick={() => void submit()} disabled={pending}>
                {pending ? (
                  <>
                    <ShieldCheck className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Confirming with the ledger…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    Confirm and send {formatMoney(amountMinor, "INR")}
                  </>
                )}
              </Button>
            </div>

            {requestIdRef.current && !pending ? (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => void recover(requestIdRef.current!)}
                disabled={recovering}
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Check the original payment status
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && payment ? (
        <PaymentResult
          payment={payment}
          onReset={reset}
          onRecover={() => {
            if (requestIdRef.current) void recover(requestIdRef.current);
          }}
          recovering={recovering}
        />
      ) : null}

      {step === 3 && !payment ? (
        <Card>
          <CardHeader>
            <CardTitle>Payment outcome not available</CardTitle>
            <CardDescription>
              {error ?? "The ledger has not confirmed this payment."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (requestIdRef.current) void recover(requestIdRef.current);
              }}
              disabled={recovering}
            >
              <ShieldCheck className={`h-4 w-4 ${recovering ? "animate-spin" : ""}`} aria-hidden="true" />
              Check payment status
            </Button>
            <Button asChild variant="outline">
              <Link href="/transactions?filter=PROCESSING">Open pending activity</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PaymentResult({
  payment,
  onReset,
  onRecover,
  recovering,
}: {
  payment: PaymentView;
  onReset: () => void;
  onRecover: () => void;
  recovering: boolean;
}) {
  const settled = payment.status === "SETTLED";
  const rejected = payment.status === "REJECTED";
  const unresolved = !settled && !rejected;
  const reference = payment.paymentRef ?? payment.transaction?.paymentRef ?? null;

  return (
    <Card className="overflow-hidden">
      <div
        className={`h-1.5 w-full ${
          settled ? "bg-emerald-500" : unresolved ? "bg-amber-500" : "bg-red-500"
        }`}
      />
      <CardHeader className="items-center text-center">
        <span
          className={`grid h-14 w-14 place-items-center rounded-2xl ${
            settled
              ? "bg-emerald-50 text-emerald-700"
              : unresolved
                ? "bg-amber-50 text-amber-700"
                : "bg-red-50 text-red-700"
          }`}
        >
          {settled ? (
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          ) : (
            <TriangleAlert className="h-7 w-7" aria-hidden="true" />
          )}
        </span>
        <CardTitle className="pt-2 text-xl">
          {settled
            ? "Payment successful"
            : unresolved
              ? "Payment is being verified"
              : "Payment failed"}
        </CardTitle>
        <CardDescription>
          {settled
            ? "The Raftline settlement receipt matched this payment and is committed."
            : unresolved
              ? "No success has been reported. The original payment is preserved and cannot be replaced automatically."
              : payment.failureMessage ?? "The ledger rejected this payment. No money was sent."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-border bg-secondary/30 px-5 py-5 text-center">
          <p className="text-xs text-muted-foreground">Amount</p>
          <p className="mt-1 font-display text-3xl font-semibold tracking-[-0.04em] text-navy">
            {formatMoney(payment.amountMinor, payment.currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            to {payment.recipient.displayName} (@{payment.recipient.username})
          </p>
        </div>

        {payment.description ? (
          <p className="text-center text-xs text-muted-foreground">Note: {payment.description}</p>
        ) : null}

        {reference ? (
          <p className="break-all text-center font-mono text-xs text-muted-foreground">
            Reference: {reference}
          </p>
        ) : null}

        {payment.idempotentReplay ? (
          <p className="text-center text-xs text-muted-foreground">
            The ledger returned the original result for this request, so you were not debited twice.
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          {unresolved ? (
            <Button className="sm:flex-1" onClick={onRecover} disabled={recovering}>
              <ShieldCheck className={`h-4 w-4 ${recovering ? "animate-spin" : ""}`} aria-hidden="true" />
              Check payment status
            </Button>
          ) : null}
          {settled && reference ? (
            <Button asChild className="sm:flex-1">
              <Link href={`/transactions/${encodeURIComponent(reference)}`}>
                View receipt
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" className="sm:flex-1" onClick={onReset}>
            {unresolved ? "Start another payment" : "Send again"}
          </Button>
          <Button asChild variant="ghost" className="sm:flex-1">
            <Link href="/home">Dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-[65%] text-right font-medium">{value}</dd>
    </div>
  );
}
