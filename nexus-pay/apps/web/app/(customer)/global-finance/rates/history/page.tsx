"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { FxRateView } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, GlobalNotice } from "@/components/global/global-ui";

export default function RateHistoryPage() {
  const [pair, setPair] = useState({ base: "USD", quote: "INR" });
  const [enabled, setEnabled] = useState(false);
  const query = useQuery({
    queryKey: ["global", "rate-history", pair.base, pair.quote],
    queryFn: () => apiFetch<{ rates: FxRateView[] }>(`/api/global-finance/rates/history?base=${pair.base}&quote=${pair.quote}`),
    enabled, retry: false,
  });
  const rates = query.data?.rates ?? [];
  const values = rates.map((r) => Number(r.rate.split(".")[0]));
  const max = Math.max(1, ...values);
  const min = Math.min(...values, max);
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Historical exchange rates" description="Persisted rate history with source attribution. Historical rates are never presented as executable." />
      <GlobalNav />
      <GlobalNotice>Historical data comes from the configured provider. Reference/indicative rates must not be read as conversion opportunities.</GlobalNotice>
      <Card>
        <CardHeader><CardTitle className="text-base">Select a pair</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Input className="w-28" placeholder="Base" value={pair.base} onChange={(e) => setPair({ ...pair, base: e.target.value.toUpperCase() })} />
          <Input className="w-28" placeholder="Quote" value={pair.quote} onChange={(e) => setPair({ ...pair, quote: e.target.value.toUpperCase() })} />
          <Button onClick={() => setEnabled(true)}>Load history</Button>
        </CardContent>
      </Card>
      {query.isError ? <p className="text-sm text-destructive">No historical rate data available for this pair.</p> : null}
      {rates.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{pair.base}/{pair.quote} movement</CardTitle></CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-1">
              {rates.map((rate) => (
                <div key={rate.id} title={`${rate.rate} Â· ${new Date(rate.asOf).toLocaleDateString("en-IN")}`} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(4, ((values[rates.indexOf(rate)] - min) / (max - min || 1)) * 100)}%` }} />
              ))}
            </div>
            <div className="mt-3 max-h-56 overflow-auto">
              {rates.slice().reverse().map((rate) => (
                <div key={rate.id} className="flex justify-between py-1 text-xs text-muted-foreground">
                  <span>{new Date(rate.asOf).toLocaleDateString("en-IN")}</span>
                  <span>{rate.rate} Â· {rate.classification}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : enabled ? <p className="text-sm text-muted-foreground">No historical points persisted for this pair yet.</p> : null}
    </div>
  );
}
