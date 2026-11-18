"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { SubscriptionIntelligenceView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function SubscriptionIntelligencePage() {
  const data = useQuery({ queryKey: ["finance", "subscriptions"], queryFn: () => apiFetch<SubscriptionIntelligenceView>("/api/finance/subscriptions/overview") });
  const view = data.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Recurring commitments</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Subscription intelligence</h1>
      </div>
      {view ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Active" value={String(view.activeCount)} />
            <Metric label="Monthly commitment" value={formatMoney(view.monthlyCommitmentMinor, view.currency)} />
            <Metric label="Annual estimate" value={formatMoney(view.annualCommitmentMinor, view.currency)} />
            <Metric label="Failed renewals" value={String(view.failedCount)} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Upcoming renewals</CardTitle></CardHeader>
            <CardContent>
              {view.upcoming.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No upcoming renewals.</p> : (
                <div className="divide-y divide-border/70">
                  {view.upcoming.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 text-xs">
                      <span className="font-mono">{item.planName.slice(0, 12)}…</span>
                      <span>{formatMoney(item.amountMinor, view.currency)} · {formatDateTime(item.nextBillingDate!)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">{view.notice}</p>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-semibold text-navy">{value}</p></div>;
}
