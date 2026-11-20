"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { PortfolioView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function InvestmentsHomePage() {
  const portfolio = useQuery({ queryKey: ["investments", "portfolio"], queryFn: () => apiFetch<PortfolioView>("/api/investments/portfolio") });
  const data = portfolio.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Investments</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">Your wealth at a glance</h1>
      </div>
      <Alert><AlertDescription>{data?.notice ?? "No real investment provider is connected. Holdings are provider snapshots, not wallet money. Past performance does not guarantee future results."}</AlertDescription></Alert>
      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Current value" value={formatMoney(data.currentValueMinor, "INR")} />
          <Metric label="Invested" value={formatMoney(data.investedMinor, "INR")} />
          <Metric label="Absolute return" value={formatMoney(data.absoluteReturnMinor, "INR")} />
          <Metric label="Overall return" value={`${(data.returnPctBps / 100).toFixed(1)}%`} />
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Asset allocation</CardTitle></CardHeader>
          <CardContent>
            {(data?.allocation ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No holdings to allocate yet.</p> : (
              <div className="space-y-2">
                {data?.allocation.map((item) => (
                  <div key={item.key} className="flex justify-between text-xs">
                    <span>{item.key}</span>
                    <span className="text-muted-foreground">{(item.pctBps / 100).toFixed(1)}% · {formatMoney(item.valueMinor, "INR")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Quick actions</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline"><Link href="/investments/portfolio">View portfolio</Link></Button>
            <Button asChild variant="outline"><Link href="/investments/connections">Connect a provider</Link></Button>
            <Button asChild variant="outline"><Link href="/investments/explore">Explore funds</Link></Button>
            <Button asChild variant="outline"><Link href="/investments/wealth">Net worth</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
