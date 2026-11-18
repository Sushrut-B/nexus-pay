"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { CashFlowView, FinancePeriod } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function CashFlowPage() {
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const flow = useQuery({
    queryKey: ["finance", "cashflow", period],
    queryFn: () => apiFetch<CashFlowView>(`/api/finance/cashflow?period=${period}`),
  });
  const data = flow.data;
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Cash-flow intelligence</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Cash flow</h1>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value as FinancePeriod)} aria-label="Period" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          {[["week", "This week"], ["month", "This month"], ["last_month", "Last month"], ["quarter", "Last 3 months"], ["half_year", "Last 6 months"], ["year", "This year"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Inflow" value={formatMoney(data.totalInflowMinor, data.currency)} />
            <Metric label="Outflow" value={formatMoney(data.totalOutflowMinor, data.currency)} />
            <Metric label="Net" value={formatMoney(data.netMinor, data.currency)} />
            <Metric label="Avg daily spend" value={formatMoney(data.averageDailySpendMinor, data.currency)} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Daily cash flow</CardTitle></CardHeader>
            <CardContent>
              {data.points.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No recorded cash flow in this period.</p> : (
                <div className="space-y-2">
                  {data.points.map((point) => (
                    <div key={point.date} className="flex items-center gap-3 text-xs">
                      <span className="w-20 text-muted-foreground">{point.date}</span>
                      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className="bg-emerald-500" style={{ width: `${Math.min(100, (point.inflowMinor / Math.max(1, data.totalInflowMinor)) * 100)}%` }} />
                        <div className="bg-rose-500" style={{ width: `${Math.min(100, (point.outflowMinor / Math.max(1, data.totalOutflowMinor)) * 100)}%` }} />
                      </div>
                      <span className="w-24 text-right font-medium">+{formatMoney(point.inflowMinor, data.currency)}</span>
                      <span className="w-24 text-right font-medium">−{formatMoney(point.outflowMinor, data.currency)}</span>
                    </div>
                  ))}
                </div>
              )}
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
