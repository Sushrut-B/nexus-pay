"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { LeaderTransitionView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, EmptyState, LoadingState, StatusPill } from "@/components/control/ui";

export default function LeaderElectionsPage() {
  const transitions = useQuery({
    queryKey: ["control", "leader-history"],
    queryFn: () => apiFetch<{ items: LeaderTransitionView[] }>("/api/control/leader-history"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Consensus" title="Leader elections" description="Observed leader changes from sampled cluster status. Timestamps are observation times, not exact election events." />
      {transitions.isLoading ? <LoadingState /> : null}
      {(transitions.data?.items ?? []).length === 0 && !transitions.isLoading ? (
        <EmptyState title="No transitions observed" message="Leader changes will appear here after the collector observes them." />
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Transition timeline</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {transitions.data?.items.map((event) => (
              <li key={event.id} className="flex gap-4 border-l-2 border-slate-200 pl-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {event.fromLeaderId && event.fromLeaderId === event.toLeaderId ? (
                      <>Re-elected <span className="font-mono">{event.toLeaderId}</span></>
                    ) : (
                      <>{event.fromLeaderId ?? "No leader"} → <span className="font-mono">{event.toLeaderId ?? "No leader"}</span></>
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Term {event.term ?? "N/A"} · {event.source} · {formatDateTime(event.observedAt)}
                  </p>
                </div>
                <StatusPill state={event.source} tone="info" />
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
