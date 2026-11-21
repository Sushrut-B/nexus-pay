"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { SupportOperationsView } from "@nexus/shared-types";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { SupportNav, Metric, StatusPill } from "@/components/support/support-ui";

export default function ControlSupportPage() {
  const [status, setStatus] = useState("");
  const query = useQuery({
    queryKey: ["support-control", "overview", status],
    queryFn: () => apiFetch<SupportOperationsView>(`/api/control/support/overview?limit=50${status ? `&status=${status}` : ""}`),
  });
  const data = query.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Support Operations" title="Support inbox" description="Case queue and resolution workspace. Support cannot edit balances, Raftline records or provider status." />
      <SupportNav control />
      {query.isLoading ? <LoadingState /> : null}
      {data ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Open" value={String(data.open)} />
            <Metric label="Awaiting user" value={String(data.awaitingUser)} />
            <Metric label="Awaiting provider" value={String(data.awaitingProvider)} />
            <Metric label="Escalated" value={String(data.escalated)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Input className="w-56" placeholder="Filter by status" value={status} onChange={(e) => setStatus(e.target.value.toUpperCase())} />
            <Button asChild variant="outline"><Link href="/control/support/analytics">View analytics</Link></Button>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            {data.cases.length === 0 ? <p className="text-xs text-slate-500">No cases match this filter.</p> : data.cases.map((c) => (
              <Link key={c.id} href={`/control/support/cases/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 py-3 text-sm last:border-0">
                <span>{c.reference} Â· {c.category.replaceAll("_", " ")} <span className="ml-2 text-xs text-slate-500">({c.priority})</span></span>
                <span className="flex items-center gap-2"><StatusPill status={c.status} /><span className="text-xs text-slate-500">{new Date(c.lastActivityAt).toLocaleString("en-IN")}</span></span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
