"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { FxRateView } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, GlobalNotice, Metric } from "@/components/global/global-ui";

export default function RatesPage() {
  const [pair, setPair] = useState({ base: "USD", quote: "INR" });
  const [lookup, setLookup] = useState<string | null>(null);
  const latest = useQuery({
    queryKey: ["global", "rate", pair.base, pair.quote],
    queryFn: () => apiFetch<FxRateView>(`/api/global-finance/rates?base=${pair.base}&quote=${pair.quote}`),
    enabled: lookup === `${pair.base}/${pair.quote}`,
    retry: false,
  });
  const all = useQuery({ queryKey: ["global", "rates"], queryFn: () => apiFetch<{ rates: FxRateView[] }>("/api/global-finance/rates") });
  const rate = latest.data;
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Exchange rates" description="Source-attributed, classified rates with timestamp and freshness. Reference rates are never executable quotes." />
      <GlobalNav />
      <GlobalNotice>Rates are labelled INDICATIVE, REFERENCE, PROVIDER_QUOTE or HISTORICAL. Only a verified executable provider can offer an execution rate.</GlobalNotice>
      <Card>
        <CardHeader><CardTitle className="text-base">Currency pair lookup</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Input className="w-28" placeholder="Base" value={pair.base} onChange={(e) => setPair({ ...pair, base: e.target.value.toUpperCase() })} />
          <Input className="w-28" placeholder="Quote" value={pair.quote} onChange={(e) => setPair({ ...pair, quote: e.target.value.toUpperCase() })} />
          <Button onClick={() => setLookup(`${pair.base}/${pair.quote}`)}>Look up</Button>
        </CardContent>
      </Card>
      {lookup ? (latest.isError ? <p className="text-sm text-destructive">No source-attributed rate available. Enable and synchronise a provider in Control.</p> : rate ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Pair" value={`${rate.baseCurrency}/${rate.quoteCurrency}`} />
          <Metric label="Rate" value={rate.rate} />
          <Metric label="Classification" value={rate.classification} />
          <Metric label="Source" value={rate.providerCode} />
          <Metric label="Freshness" value={rate.isStale ? "STALE" : "Current"} />
        </div>
      ) : <p className="text-sm text-muted-foreground">Loading rateâ€¦</p>) : null}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-navy">Available rates</h2>
        {(all.data?.rates ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No rates persisted. Enable a sandbox FX provider and synchronise.</p> : (
          <div className="divide-y divide-border/70">
            {all.data?.rates.map((row) => (
              <div key={row.id} className="flex justify-between py-2 text-sm">
                <span>{row.baseCurrency}/{row.quoteCurrency}</span>
                <span className="text-muted-foreground">{row.rate} Â· {row.classification} Â· {new Date(row.asOf).toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
