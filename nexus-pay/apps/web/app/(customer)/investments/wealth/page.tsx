"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { NetWorthView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function WealthPage() {
  const netWorth = useQuery({ queryKey: ["investments", "networth"], queryFn: () => apiFetch<NetWorthView>("/api/wealth/net-worth") });
  const history = useQuery({
    queryKey: ["investments", "wealth-history"],
    queryFn: () => apiFetch<{ items: Array<{ capturedAt: string; netWorthMinor: number; completeness: string }> }>("/api/wealth/history"),
  });
  const data = netWorth.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Wealth</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Net worth overview</h1>
      </div>
      <Alert><AlertDescription>{data?.notice ?? "Net worth reuses your live Raftline wallet read and existing linked-account balances. Rewards points are excluded."}</AlertDescription></Alert>
      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Net worth" value={formatMoney(data.netWorthMinor, data.currency)} />
          <Metric label="Total assets" value={formatMoney(data.totalAssetsMinor, data.currency)} />
          <Metric label="Liabilities" value={formatMoney(data.totalLiabilitiesMinor, data.currency)} />
          <Metric label="Completeness" value={data.completeness} />
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Composition</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Wallet (Raftline): {data ? formatMoney(data.walletMinor, data.currency) : "—"}</p>
            <p>Linked banks: {data ? formatMoney(data.bankMinor, data.currency) : "—"}</p>
            <p>Investments: {data ? formatMoney(data.investmentsMinor, data.currency) : "—"}</p>
            <p>Fixed income: {data ? formatMoney(data.fixedIncomeMinor, data.currency) : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Wealth history</CardTitle></CardHeader>
          <CardContent>
            {(history.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">Snapshots will appear after synchronization.</p> : (
              <div className="divide-y divide-border/70">
                {history.data?.items.slice(-10).map((item) => (
                  <div key={item.capturedAt} className="flex justify-between py-2 text-xs"><span>{new Date(item.capturedAt).toLocaleDateString("en-IN")}</span><span className="text-muted-foreground">{formatMoney(item.netWorthMinor, "INR")} · {item.completeness}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
