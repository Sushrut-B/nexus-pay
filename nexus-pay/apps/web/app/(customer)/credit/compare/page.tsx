"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { ComparisonResult, CreditOfferView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function ComparePage() {
  const offers = useQuery({ queryKey: ["credit", "offers"], queryFn: () => apiFetch<{ items: CreditOfferView[] }>("/api/credit/offers") });
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const compare = useMutation({
    mutationFn: () => apiFetch<ComparisonResult>("/api/credit/offers/compare", { method: "POST", body: JSON.stringify({ offerIds: selected }) }),
    onSuccess: setResult,
  });
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-4));
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Loan comparison</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Compare offers</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Select 2–4 offers</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(offers.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No offers available.</p> : (
            offers.data?.items.map((offer) => (
              <label key={offer.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                <input type="checkbox" checked={selected.includes(offer.id)} onChange={() => toggle(offer.id)} />
                <span className="flex-1">{offer.providerName} · {offer.productName}</span>
                <span>{(offer.interestRateBps / 100).toFixed(2)}% · {formatMoney(offer.amountMinor, "INR")}</span>
              </label>
            ))
          )}
          <Button disabled={selected.length < 2 || compare.isPending} onClick={() => compare.mutate()}>Compare</Button>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Comparison</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {result.offers.map((offer) => (
              <div key={offer.id} className="rounded-lg border border-border p-3">
                <p className="font-medium">{offer.providerName} · {offer.productName}</p>
                <p>EMI {formatMoney(offer.emiMinor ?? 0, "INR")} · total repayment {formatMoney(offer.totalRepaymentMinor ?? 0, "INR")} · interest {formatMoney(offer.totalInterestMinor ?? 0, "INR")} · fees {formatMoney(offer.feesMinor, "INR")}</p>
                {offer.isSandbox ? <p className="text-xs text-amber-700">Sandbox fixture — not a real offer.</p> : null}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{result.method}</p>
            <Alert><AlertDescription>{result.notice}</AlertDescription></Alert>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
