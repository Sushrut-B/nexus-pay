"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@nexus/ui";
import type { AdminRewardsOverview } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

export default function ControlRewardsPage() {
  const overview = useQuery({
    queryKey: ["control", "rewards", "overview"],
    queryFn: () => apiFetch<AdminRewardsOverview>("/api/control/rewards/overview"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Rewards operations" description="Real persisted rewards metrics. Points are non-cash; cashback values are sandbox wallet credits." />
      {overview.isLoading ? <LoadingState /> : null}
      {overview.data ? (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Points issued" value={overview.data.points.issued.toLocaleString("en-IN")} />
            <Metric label="Points redeemed" value={overview.data.points.redeemed.toLocaleString("en-IN")} />
            <Metric label="Points expired" value={overview.data.points.expired.toLocaleString("en-IN")} />
            <Metric label="Outstanding points" value={overview.data.points.outstanding.toLocaleString("en-IN")} />
            <Metric label="Cashback entitlements" value={String(overview.data.cashback.entitlements)} />
            <Metric label="Cashback credited" value={formatMoney(overview.data.cashback.creditedMinor, "INR")} />
            <Metric label="Cashback pending" value={formatMoney(overview.data.cashback.pendingMinor, "INR")} />
            <Metric label="Failed cashback" value={String(overview.data.cashback.failed)} />
            <Metric label="Active campaigns" value={String(overview.data.campaigns.active)} />
            <Metric label="Exhausted campaigns" value={String(overview.data.campaigns.exhausted)} />
            <Metric label="Redemptions" value={String(overview.data.redemptions)} />
            <Metric label="Open risk events" value={String(overview.data.riskEvents)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/control/rewards/campaigns">Campaign queue</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/control/rewards/cashback">Cashback operations</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/control/rewards/investigations">Investigations</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/control/rewards/reconciliation">Reconciliation</Link></Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}

