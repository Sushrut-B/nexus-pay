"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { SupportOperationsView } from "@nexus/shared-types";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { SupportNav, StatusPill } from "@/components/support/support-ui";

export default function SupportEscalationsPage() {
  const query = useQuery({ queryKey: ["support-control", "escalations"], queryFn: () => apiFetch<SupportOperationsView>("/api/control/support/overview?status=ESCALATED&limit=100") });
  return (
    <div>
      <ControlPageHeader eyebrow="Support Operations" title="Escalation view" description="Cases escalated through documented signals. Internal signals are not exposed to customers." />
      <SupportNav control />
      {query.isLoading ? <LoadingState /> : null}
      {(query.data?.cases ?? []).length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No escalated cases.</p> : (
        <div className="rounded-xl border border-border bg-card p-4">
          {query.data?.cases.map((c) => (
            <Link key={c.id} href={`/control/support/cases/${c.id}`} className="flex justify-between border-b border-border/70 py-3 text-sm last:border-0">
              <span>{c.reference} Â· {c.category}</span><span className="flex items-center gap-2"><StatusPill status={c.status} /><span className="text-xs text-slate-500">{c.priority}</span></span>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-4"><Button asChild variant="outline"><Link href="/control/support">Back to inbox</Link></Button></div>
    </div>
  );
}
