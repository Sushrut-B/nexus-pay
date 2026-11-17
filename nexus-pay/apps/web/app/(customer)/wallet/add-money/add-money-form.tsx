"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import type { FundingView, WalletOverview } from "@nexus/shared-types";
import { MAX_FUNDING_MINOR, majorToMinor, parseMajorToMinor } from "@nexus/shared-types";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Plus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { SimulationNotice } from "@/components/payments/simulation-notice";
import { StepIndicator } from "@/components/payments/step-indicator";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatMoney, maskAccountId } from "@/lib/format";

const QUICK_AMOUNTS = [500, 1000, 2000, 5000, 10000];
const PENDING_KEY = "nexuspay.funding.pending";

interface PendingFunding {
  clientRequestId: string;
  walletId: string;
  amountMinor: number;
  createdAt: string;
}

function readPending(): PendingFunding | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingFunding;
    if (typeof value.clientRequestId !== "string" || typeof value.walletId !== "string") {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function writePending(value: PendingFunding | null): void {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(PENDING_KEY, JSON.stringify(value));
  else window.localStorage.removeItem(PENDING_KEY);
}

export function AddMoneyForm({
  overview,
  recentFunding,
}: {
  overview: WalletOverview | null;
  recentFunding: FundingView[];
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [amountInput, setAmountInput] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<FundingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingFunding | null>(null);

  const wallet = overview?.wallet ?? null;
  const balance = overview?.balance ?? null;
  const active = wallet?.status === "ACTIVE" && Boolean(wallet?.raftlineAccountId);

  const parsed = parseMajorToMinor(amountInput, MAX_FUNDING_MINOR);
  const amountMinor = parsed.ok ? parsed.amountMinor : null;

  const applyResult = useCallback(
    (funding: FundingView) => {
      setResult(funding);
      setStep(2);
      setError(null);
      if (funding.status === "COMPLETED" || funding.status === "FAILED") {
        requestIdRef.current = null;
        pendingRef.current = null;
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
        const funding = await apiFetch<FundingView>(
          `/api/funding/recovery?clientRequestId=${encodeURIComponent(clientRequestId)}`,
        );
        if (funding.status === "COMPLETED" || funding.status === "FAILED") {
          applyResult(funding);
        } else if (!silent) {
          applyResult(funding);
        }
      } catch (recoveryError) {
        if (!silent) {
          setError(
            recoveryError instanceof ApiClientError
              ? recoveryError.message
              : "The ledger outcome could not be checked yet. No new funds were requested.",
          );
        }
      } finally {
        setRecovering(false);
      }
    },
    [applyResult],
  );

  useEffect(() => {
    const stored = readPending();
    if (!stored) return;
    pendingRef.current = stored;
    requestIdRef.current = stored.clientRequestId;
    void recover(stored.clientRequestId, true);
  }, [recover]);

  function chooseAmount(value: number) {
    setAmountInput(String(value));
    setFieldError(null);
  }

  function review() {
    if (!active) {
      setFieldError("Your wallet must be active before adding simulated funds.");
      return;
    }
    if (!parsed.ok) {
      setFieldError(
        parsed.reason === "NON_POSITIVE"
          ? "Enter an amount greater than zero."
          : parsed.reason === "TOO_LARGE"
            ? `The maximum simulated funding amount is ${formatMoney(MAX_FUNDING_MINOR, "INR")}.`
            : "Enter a valid amount with up to two decimal places.",
      );
      return;
    }
    setFieldError(null);
    setStep(1);
  }

  async function submit() {
    if (!wallet || !amountMinor) return;
    setPending(true);
    setError(null);
    const clientRequestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    const pendingValue: PendingFunding = {
      clientRequestId,
      walletId: wallet.id,
      amountMinor,
      createdAt: new Date().toISOString(),
    };
    pendingRef.current = pendingValue;
    writePending(pendingValue);

    try {
      const funding = await apiFetch<FundingView>(`/api/wallets/${wallet.id}/fund`, {
        method: "POST",
        body: JSON.stringify({ clientRequestId, amountMinor }),
      });
      applyResult(funding);
    } catch (submitError) {
      if (submitError instanceof ApiClientError) {
        setError(submitError.message);
        if (submitError.status < 500 && submitError.status !== 409) {
          requestIdRef.current = null;
          pendingRef.current = null;
          writePending(null);
        }
      } else {
        setError(
          "We could not confirm this simulated funding request. It may still be committed. Check its status before trying again.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setStep(0);
    setAmountInput("");
    setResult(null);
    setError(null);
    setFieldError(null);
    requestIdRef.current = null;
    pendingRef.current = null;
    writePending(null);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/wallet">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Wallet
          </Link>
        </Button>
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Simulated funding
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Add sandbox money
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create test funds on your Raftline ledger account. The new balance only appears after the
          ledger receipt is verified.
        </p>
      </div>

      <SimulationNotice />

      <StepIndicator steps={["Amount", "Review", "Result"]} current={step} />

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How much would you like to add?</CardTitle>
            <CardDescription>
              Current available balance:{" "}
              {balance
                ? formatMoney(balance.availableMinor, balance.currency)
                : wallet?.status === "ACTIVE"
                  ? "temporarily unavailable"
                  : "wallet not active"}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <label htmlFor="funding-amount" className="text-sm font-medium text-foreground">
                Amount (INR)
              </label>
              <div className="mt-2 flex items-center rounded-xl border border-input bg-background px-4 focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/10">
                <span className="text-lg font-semibold text-muted-foreground">₹</span>
                <input
                  id="funding-amount"
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
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Minimum ₹1.00 · Maximum ₹1,00,000.00 per request.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant={amountInput === String(amount) ? "default" : "outline"}
                  size="sm"
                  onClick={() => chooseAmount(amount)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatMoney(majorToMinor(amount), "INR")}
                </Button>
              ))}
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
              This is not a bank deposit, card payment or UPI transfer. Simulated funds have no
              real-world value.
            </div>

            <Button className="w-full" onClick={review} disabled={!active}>
              Review simulated funding
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            {!active ? (
              <p className="text-center text-xs text-muted-foreground">
                Your wallet needs to be active before funds can be added.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review simulated funding</CardTitle>
            <CardDescription>Confirm the amount and destination before submitting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl border border-border bg-secondary/30 px-5 py-6 text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                You are adding
              </p>
              <p className="mt-2 font-display text-4xl font-semibold tracking-[-0.04em] text-navy">
                {amountMinor ? formatMoney(amountMinor, "INR") : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">SIMULATED SANDBOX FUNDING</p>
            </div>

            <dl className="space-y-3 text-sm">
              <ReviewRow label="To wallet" value={wallet ? maskAccountId(wallet.raftlineAccountId) : "—"} />
              <ReviewRow label="Wallet status" value={wallet?.status ?? "—"} />
              <ReviewRow label="Currency" value="INR" />
              <ReviewRow label="Fee" value="None" />
              <ReviewRow
                label="New balance"
                value="Shown after ledger confirmation"
              />
            </dl>

            <SimulationNotice compact />

            {error ? (
              <Alert variant="warning">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Funding needs confirmation</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="sm:flex-1"
                onClick={() => setStep(0)}
                disabled={pending}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </Button>
              <Button className="sm:flex-[2]" onClick={() => void submit()} disabled={pending}>
                {pending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Confirming with the ledger…
                  </>
                ) : (
                  <>
                    <FlaskConical className="h-4 w-4" aria-hidden="true" />
                    Confirm and add {amountMinor ? formatMoney(amountMinor, "INR") : ""}
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
                Check the original request status
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 2 && result ? (
        <FundingResult funding={result} onReset={reset} onRecover={() => {
          if (requestIdRef.current) void recover(requestIdRef.current);
        }} recovering={recovering} />
      ) : null}

      {step === 2 && !result ? (
        <Card>
          <CardHeader>
            <CardTitle>Funding outcome not available</CardTitle>
            <CardDescription>{error ?? "The ledger has not confirmed this request."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (requestIdRef.current) void recover(requestIdRef.current);
              }}
              disabled={recovering}
            >
              <RefreshCw className={`h-4 w-4 ${recovering ? "animate-spin" : ""}`} aria-hidden="true" />
              Check status
            </Button>
            <Button variant="outline" onClick={reset}>
              Start a new request
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 0 && recentFunding.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent simulated funding</CardTitle>
            <CardDescription>Only verified ledger outcomes are labelled successful.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/70">
              {recentFunding.slice(0, 4).map((funding) => (
                <li key={funding.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium">
                      {formatMoney(funding.amountMinor, funding.currency)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {funding.completedAt ? new Date(funding.completedAt).toLocaleString("en-IN") : "Pending"}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {funding.status === "COMPLETED"
                      ? "Successful"
                      : funding.status === "FAILED"
                        ? "Failed"
                        : "Verification"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function FundingResult({
  funding,
  onReset,
  onRecover,
  recovering,
}: {
  funding: FundingView;
  onReset: () => void;
  onRecover: () => void;
  recovering: boolean;
}) {
  const successful = funding.status === "COMPLETED";
  const unresolved = funding.status === "UNKNOWN" || funding.status === "RECONCILIATION_REQUIRED" || funding.status === "PROCESSING";
  const reference = funding.fundingRef;

  return (
    <Card className="overflow-hidden">
      <div className={`h-1.5 w-full ${successful ? "bg-emerald-500" : unresolved ? "bg-amber-500" : "bg-red-500"}`} />
      <CardHeader className="items-center text-center">
        <span
          className={`grid h-14 w-14 place-items-center rounded-2xl ${
            successful ? "bg-emerald-50 text-emerald-700" : unresolved ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"
          }`}
        >
          {successful ? (
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          ) : (
            <TriangleAlert className="h-7 w-7" aria-hidden="true" />
          )}
        </span>
        <CardTitle className="pt-2 text-xl">
          {successful
            ? "Simulated funds added"
            : unresolved
              ? "Funding is still being verified"
              : "Simulated funding failed"}
        </CardTitle>
        <CardDescription>
          {successful
            ? "The ledger receipt matched this request and the credit is committed."
            : unresolved
              ? "No success has been reported. The original request is preserved for reconciliation."
              : funding.failureMessage ?? "The ledger did not add simulated funds."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-border bg-secondary/30 px-5 py-5 text-center">
          <p className="text-xs text-muted-foreground">Requested amount</p>
          <p className="mt-1 font-display text-3xl font-semibold tracking-[-0.04em] text-navy">
            {formatMoney(funding.amountMinor, funding.currency)}
          </p>
          {successful && funding.balanceAfterMinor !== null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Ledger balance after credit: {formatMoney(funding.balanceAfterMinor, funding.currency)}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          SIMULATED SANDBOX FUNDING. This is test money inside the Nexus Pay sandbox, not a bank
          deposit or real-world funds.
        </div>

        {reference ? (
          <p className="break-all text-center font-mono text-xs text-muted-foreground">
            Reference: {reference}
          </p>
        ) : null}

        {funding.idempotentReplay ? (
          <p className="text-center text-xs text-muted-foreground">
            The ledger returned the original result for this request, so it was not credited twice.
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          {unresolved ? (
            <Button className="sm:flex-1" onClick={onRecover} disabled={recovering}>
              <RefreshCw className={`h-4 w-4 ${recovering ? "animate-spin" : ""}`} aria-hidden="true" />
              Check again
            </Button>
          ) : null}
          {successful && reference ? (
            <Button asChild className="sm:flex-1">
              <Link href={`/transactions/${encodeURIComponent(reference)}`}>
                View receipt
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" className="sm:flex-1" onClick={onReset}>
            Add more
          </Button>
          <Button asChild variant="ghost" className="sm:flex-1">
            <Link href="/wallet">Back to wallet</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
