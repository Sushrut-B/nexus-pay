"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import type { SupportOperationsView } from "@nexus/shared-types";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { Metric, SupportNav } from "@/components/support/support-ui";

export default function SupportAnalyticsPage() {
  const query = useQuery({ queryKey: ["support-control", "analytics"], queryFn: () => apiFetch<SupportOperationsView>("/api/control/support/overview?limit=1") });
  const d = query.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Support Operations" title="Support analytics" description="Metrics derived from actual case timestamps. No service-level commitment is implied." />
      <SupportNav control />
      {query.isLoading ? <LoadingState /> : null}
      {d ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Total cases" value={String(d.total)} />
            <Metric label="Open" value={String(d.open)} />
            <Metric label="Resolved" value={String(d.resolved)} />
            <Metric label="Reopen rate (bps)" value={String(d.reopenRateBps)} />
            <Metric label="First response (min)" value={d.firstResponseMinutes == null ? "â€”" : String(d.firstResponseMinutes)} />
            <Metric label="Resolution (min)" value={d.resolutionMinutes == null ? "â€”" : String(d.resolutionMinutes)} />
            <Metric label="Awaiting user" value={String(d.awaitingUser)} />
            <Metric label="Awaiting provider" value={String(d.awaitingProvider)} />
          </div>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Volume by category</h2>
            {Object.entries(d.byCategory).map(([k, v]) => <p key={k} className="py-1 text-xs">{k}: {v}</p>)}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Backlog aging</h2>
            {Object.entries(d.backlogAging).map(([k, v]) => <p key={k} className="py-1 text-xs">{k}: {v}</p>)}
          </section>
          <p className="text-xs text-slate-500">{d.notice}</p>
        </div>
      ) : null}
    </div>
  );
}
