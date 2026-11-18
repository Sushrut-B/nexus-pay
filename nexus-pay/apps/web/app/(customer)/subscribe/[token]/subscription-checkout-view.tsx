"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import { formatDateTime, formatMoney, initials } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";

interface Checkout {
  merchant: { id: string; displayName: string; handle: string; logoUrl: string | null; brandColor: string | null };
  plan: {
    id: string; name: string; description: string | null; amountMinor: number; setupFeeMinor: number;
    currency: string; frequency: string; intervalCount: number; trialDays: number;
    introPriceMinor: number | null; introPeriods: number; cancellationPolicy: string | null;
  };
  amountDueTodayMinor: number;
  firstBillingDate: string;
  subsequentBilling: string;
  trialEndDate: string | null;
  cancellationPolicy: string | null;
  signedIn: boolean;
  sandboxNotice: string;
}

export function SubscriptionCheckoutView({ token }: { token: string }) {
  const checkout = useQuery({
    queryKey: ["subscribe", token],
    queryFn: () => apiFetch<Checkout>(`/api/subscribe/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ subscriptionId: string; receipt: string | null; portal: string } | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const outcome = await apiFetch<{ subscription: { id: string }; receipt: string | null; portal: string }>(
        `/api/subscribe/${encodeURIComponent(token)}/confirm`,
        { method: "POST", body: JSON.stringify({ clientRequestId: crypto.randomUUID(), acceptTerms: true }) },
      );
      setResult({ subscriptionId: outcome.subscription.id, receipt: outcome.receipt, portal: outcome.portal });
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "Could not complete subscription.");
    } finally {
      setPending(false);
    }
  }

  const data = checkout.data;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Nexus Pay subscriptions</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-navy">Subscribe securely</h1>
      </div>

      {checkout.isError ? <Alert variant="destructive"><AlertDescription>{checkout.error instanceof ApiClientError ? checkout.error.message : "This plan could not be loaded."}</AlertDescription></Alert> : null}
      {data ? (
        <Card>
          <CardHeader className="items-center text-center">
            {data.merchant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.merchant.logoUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-xl bg-navy text-lg font-semibold text-white">{initials(data.merchant.displayName)}</span>
            )}
            <CardTitle className="pt-2 text-lg">{data.plan.name}</CardTitle>
            <CardDescription>@{data.merchant.handle} · sandbox merchant</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {data.plan.description ? <p className="text-sm text-muted-foreground">{data.plan.description}</p> : null}
            <div className="rounded-2xl border border-border bg-secondary/30 px-5 py-6">
              <p className="text-center text-xs text-muted-foreground">Recurring price</p>
              <p className="mt-1 text-center font-display text-4xl font-semibold tracking-[-0.04em] text-navy">{formatMoney(data.plan.amountMinor, data.plan.currency)}</p>
              <p className="mt-1 text-center text-xs text-muted-foreground">{data.subsequentBilling}</p>
              {data.plan.introPriceMinor !== null ? (
                <p className="mt-2 text-center text-xs text-emerald-700">Introductory price {formatMoney(data.plan.introPriceMinor, data.plan.currency)} for {data.plan.introPeriods} {data.plan.introPeriods === 1 ? "period" : "periods"}</p>
              ) : null}
              {data.plan.trialDays > 0 ? <p className="mt-1 text-center text-xs text-emerald-700">{data.plan.trialDays}-day free trial — no charge today</p> : null}
              {data.plan.setupFeeMinor > 0 ? <p className="mt-1 text-center text-xs text-muted-foreground">Plus a one-time setup fee of {formatMoney(data.plan.setupFeeMinor, data.plan.currency)}</p> : null}
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Due today: <strong className="text-foreground">{formatMoney(data.amountDueTodayMinor, data.plan.currency)}</strong></p>
              <p>First billing date: {formatDateTime(data.firstBillingDate)}</p>
              <p>Subsequent billing: {data.subsequentBilling}</p>
              {data.cancellationPolicy ? <p>Cancellation policy: {data.cancellationPolicy}</p> : null}
            </div>
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">{data.sandboxNotice}</div>

            {result ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-800">Subscription created</p>
                <p className="mt-1 font-mono text-xs">{result.subscriptionId}</p>
                <div className="mt-3 flex justify-center gap-2">
                  {result.receipt ? <Button asChild size="sm"><Link href={result.receipt}>View receipt</Link></Button> : null}
                  <Button asChild size="sm" variant="outline"><Link href={result.portal}>Manage subscription</Link></Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
                  I understand this is a sandbox recurring arrangement. Each renewal is a separate Nexus Pay wallet settlement and requires this authorization policy.
                </label>
                {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
                {data.signedIn ? (
                  <Button className="w-full" disabled={!accepted || pending} onClick={() => void confirm()}>
                    {pending ? "Confirming…" : `Confirm and subscribe${data.amountDueTodayMinor > 0 ? ` · ${formatMoney(data.amountDueTodayMinor, data.plan.currency)}` : ""}`}
                  </Button>
                ) : (
                  <Button asChild className="w-full"><Link href={`/login?next=${encodeURIComponent(`/subscribe/${token}`)}`}>Sign in to subscribe</Link></Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
