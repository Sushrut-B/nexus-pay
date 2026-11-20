"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { FundView, InstrumentView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function ExplorePage() {
  const [q, setQ] = useState("SBN");
  const [submitted, setSubmitted] = useState("SBN");
  const funds = useQuery({ queryKey: ["investments", "funds"], queryFn: () => apiFetch<{ items: FundView[] }>("/api/investments/funds") });
  const instruments = useQuery({
    queryKey: ["investments", "instruments", submitted],
    queryFn: () => apiFetch<{ items: InstrumentView[] }>(`/api/investments/instruments?q=${encodeURIComponent(submitted)}`),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Explore</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Funds and market instruments</h1>
      </div>
      <Alert><AlertDescription>Informational research only. No trading, order placement or mutual fund purchasing is available. Past performance does not guarantee future results. Prices may be delayed or end-of-day.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Mutual funds</CardTitle></CardHeader>
        <CardContent>
          {(funds.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No provider-backed funds available.</p> : (
            <div className="divide-y divide-border/70">
              {funds.data?.items.map((fund) => (
                <div key={fund.id} className="flex justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium">{fund.name}</p>
                    <p className="text-xs text-muted-foreground">{fund.amc} · {fund.category} · {fund.riskometer ?? "Risk unavailable"}</p>
                  </div>
                  <div className="text-right">
                    <p>{fund.navMinor === null ? "NAV unavailable" : formatMoney(fund.navMinor, "INR")}</p>
                    <p className="text-[11px] text-muted-foreground">as of {fund.navDate ? new Date(fund.navDate).toLocaleDateString("en-IN") : "unknown"} · sandbox fixture</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Instruments</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol or name" className="max-w-sm" />
            <Button onClick={() => setSubmitted(q)}>Search</Button>
          </div>
          {(instruments.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No instrument data available.</p> : (
            <div className="divide-y divide-border/70">
              {instruments.data?.items.map((item) => (
                <div key={item.id} className="flex justify-between py-3 text-sm">
                  <div><p className="font-medium">{item.symbol}</p><p className="text-xs text-muted-foreground">{item.name} · {item.exchange ?? "—"} · {item.feedType}</p></div>
                  <div className="text-right"><p>{item.priceMinor === null ? "Price unavailable" : formatMoney(item.priceMinor, "INR")}</p><p className={`text-[11px] ${item.changePct >= 0 ? "text-emerald-700" : "text-red-700"}`}>{item.changePct / 100}%</p></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
