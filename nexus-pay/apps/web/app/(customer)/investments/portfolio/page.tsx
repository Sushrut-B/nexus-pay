"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { PortfolioView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function PortfolioPage() {
  const portfolio = useQuery({ queryKey: ["investments", "portfolio"], queryFn: () => apiFetch<PortfolioView>("/api/investments/portfolio") });
  const transactions = useQuery({
    queryKey: ["investments", "transactions"],
    queryFn: () => apiFetch<{ items: Array<{ id: string; type: string; amountMinor: number; occurredAt: string; providerRef: string }> }>("/api/investments/portfolio/transactions"),
  });
  const data = portfolio.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Portfolio</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Holdings and performance</h1>
      </div>
      <Alert><AlertDescription>Only provider-reported snapshots are shown. Values may be stale; check the reported timestamp on each holding.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Holdings ({data?.holdingsCount ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {(data?.holdings ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No holdings yet. Connect a supported provider or add a fixed-income asset.</p> : (
            <div className="divide-y divide-border/70">
              {data?.holdings.map((holding) => (
                <div key={holding.id} className="flex justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium">{holding.name}</p>
                    <p className="text-xs text-muted-foreground">{holding.category} · {holding.source} · {new Date(holding.providerReportedAt).toLocaleString("en-IN")}</p>
                  </div>
                  <div className="text-right">
                    <p>{formatMoney(holding.valueMinor, holding.currency)}</p>
                    {holding.isStale ? <p className="text-[11px] text-amber-700">Potentially stale</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Investment activity</CardTitle></CardHeader>
        <CardContent>
          {(transactions.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No provider-reported transactions.</p> : (
            <div className="divide-y divide-border/70">
              {transactions.data?.items.map((tx) => (
                <div key={tx.id} className="flex justify-between py-2 text-xs">
                  <span>{tx.type} · {tx.providerRef}</span>
                  <span className="text-muted-foreground">{formatMoney(tx.amountMinor, "INR")} · {new Date(tx.occurredAt).toLocaleDateString("en-IN")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
