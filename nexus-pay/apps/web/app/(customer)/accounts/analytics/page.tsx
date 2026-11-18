"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { AccountAnalyticsView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function AccountAnalyticsPage() {
  const [scope, setScope] = useState("ALL");
  const analytics = useQuery({
    queryKey: ["accounts", "analytics", scope],
    queryFn: () => apiFetch<AccountAnalyticsView>(`/api/accounts/analytics/overview?scope=${scope}`),
  });
  const data = analytics.data;
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Consolidated view</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Account analytics</h1>
        </div>
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          <option value="ALL">All accounts</option>
          <option value="WALLET">Wallet only</option>
        </select>
      </div>
      {data ? (
        <>
          <Alert><AlertDescription>{data.notice}</AlertDescription></Alert>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Cash balances" value={formatMoney(data.cashBalanceMinor, data.currency)} />
            <Metric label="Liabilities" value={formatMoney(data.liabilityMinor, data.currency)} />
            <Metric label="Net position" value={formatMoney(data.netPositionMinor, data.currency)} />
            <Metric label="Inflow / outflow" value={`${formatMoney(data.inflowMinor, data.currency)} / ${formatMoney(data.outflowMinor, data.currency)}`} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Account balances</CardTitle></CardHeader>
            <CardContent>
              {data.accountBreakdown.map((account) => (
                <div key={account.accountId} className="flex items-center justify-between py-2 text-sm">
                  <span>{account.label}</span>
                  <span className={account.liability ? "text-amber-700" : ""}>{formatMoney(account.balanceMinor, data.currency)} {account.liability ? "(liability)" : ""}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-semibold text-navy">{value}</p></div>;
}
