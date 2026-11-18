"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { OfferSummary } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";

export function OfferDetailView({ id }: { id: string }) {
  const offer = useQuery({
    queryKey: ["rewards", "offer", id],
    queryFn: () => apiFetch<OfferSummary>(`/api/rewards/offers/${encodeURIComponent(id)}`),
    retry: false,
  });
  const data = offer.data;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Offer details</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.name ?? "Offer"}</h1>
      </div>
      {offer.isError ? <Alert variant="destructive"><AlertDescription>{offer.error instanceof ApiClientError ? offer.error.message : "Offer unavailable."}</AlertDescription></Alert> : null}
      {data ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{data.typeLabel}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{data.description}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <p>Minimum spend: <strong>{formatMoney(data.minSpendMinor, "INR")}</strong></p>
              <p>Maximum reward: <strong>{formatMoney(data.maxRewardMinor, "INR")}</strong></p>
              <p>Starts: {formatDateTime(data.startAt)}</p>
              <p>Ends: {formatDateTime(data.endAt)}</p>
              <p>Remaining budget: {formatMoney(data.remainingBudgetMinor, "INR")}</p>
              <p>Eligibility: <strong>{data.eligible ? "Eligible" : data.eligibilityReason}</strong></p>
            </div>
            {data.cashbackBps > 0 ? <p>Cashback rate: {(data.cashbackBps / 100).toFixed(0)}% of eligible spend.</p> : null}
            {data.pointsPerMinor > 0 ? <p>Points: {data.pointsPerMinor} per ₹100 spent.</p> : null}
            {data.promoCode ? <p className="font-mono">Promo code: {data.promoCode}</p> : null}
            <Alert><AlertDescription>Rewards are sandbox-only. Points are non-cash loyalty units; cashback is credited through the existing Raftline-backed funding flow.</AlertDescription></Alert>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
