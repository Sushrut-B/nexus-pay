"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@nexus/ui";
import type { FinanceOverviewExtended, FinancePeriod } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function FinanceOverviewPage() {
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const overview = useQuery({
    queryKey: ["finance", "overview", period],
    queryFn: () => apiFetch<FinanceOverviewExtended>(`/api/finance/overview?period=${period}`),
  });
  const data = overview.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Financial intelligence</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">Financial overview</h1>
        </div>
        <select value={period} onChange={(event) => setPeriod(event.target.value as FinancePeriod)} aria-label="Period" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          {[["week", "This week"], ["month", "This month"], ["last_month", "Last month"], ["quarter", "Last 3 months"], ["half_year", "Last 6 months"], ["year", "This year"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {data ? (
        <>
          <Alert><AlertDescription>{data.notice} Data completeness: {(data.completenessBps / 100).toFixed(0)}%.</AlertDescription></Alert>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Wallet balance (Raftline)" value={formatMoney(data.walletBalanceMinor, data.currency)} accent />
            <Metric label="Recorded inflow" value={formatMoney(data.inflowMinor, data.currency)} />
            <Metric label="Recorded outflow" value={formatMoney(data.outflowMinor, data.currency)} />
            <Metric label="Net cash flow" value={formatMoney(data.netCashFlowMinor, data.currency)} />
            <Metric label="Monthly savings estimate" value={formatMoney(data.savingsEstimateMinor, data.currency)} />
            <Metric label="Current spend" value={formatMoney(data.currentMonthSpendMinor, data.currency)} />
            <Metric label="Upcoming scheduled" value={formatMoney(data.upcomingScheduledMinor, data.currency)} />
            <Metric label="Upcoming subscriptions" value={formatMoney(data.upcomingSubscriptionMinor, data.currency)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild><Link href="/finance/cashflow">Explore cash flow</Link></Button>
            <Button asChild variant="outline"><Link href="/finance/assistant">Ask the assistant</Link></Button>
            <Button asChild variant="outline"><Link href="/finance/health">View health score</Link></Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className={`rounded-2xl border p-5 ${accent ? "border-primary/30 bg-accent" : "border-border bg-card"}`}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}

