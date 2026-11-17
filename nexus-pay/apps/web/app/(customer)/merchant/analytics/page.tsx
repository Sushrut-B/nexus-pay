"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { MerchantAnalytics } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function AnalyticsPage() {
  const [range, setRange] = useState("month");
  const analytics = useQuery({
    queryKey: ["merchant", "analytics", range],
    queryFn: () => apiFetch<MerchantAnalytics>(`/api/merchant/analytics/overview?range=${range}`),
  });
  const data = analytics.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Insights</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Analytics</h1></div>
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Range" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          {[["today", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"], ["90days", "Last 90 days"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Gross volume" value={formatMoney(data.grossVolumeMinor, "INR")} />
            <Metric label="Net volume" value={formatMoney(data.netVolumeMinor, "INR")} />
            <Metric label="Successful payments" value={String(data.successfulPayments)} />
            <Metric label="Refunded" value={formatMoney(data.refundedMinor, "INR")} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Daily revenue</CardTitle></CardHeader>
            <CardContent>
              {data.byDay.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No activity in this range.</p> : (
                <div className="space-y-2">
                  {data.byDay.map((day) => (
                    <div key={day.date} className="flex items-center gap-3 text-xs">
                      <span className="w-20 text-muted-foreground">{day.date}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (day.amountMinor / Math.max(1, data.grossVolumeMinor)) * 100)}%` }} /></div>
                      <span className="w-24 text-right font-medium">{formatMoney(day.amountMinor, "INR")}</span>
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
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}

