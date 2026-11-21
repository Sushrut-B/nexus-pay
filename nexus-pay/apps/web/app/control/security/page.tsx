"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { IdentitySecurityOperationsView } from "@nexus/shared-types";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";

export default function ControlSecurityPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState("");
  const query = useQuery({
    queryKey: ["security-control", type],
    queryFn: () => apiFetch<IdentitySecurityOperationsView>(`/api/control/security/overview?limit=50${type ? `&type=${type}` : ""}`),
  });
  const data = query.data;
  const post = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => apiFetch(`/api/control/security/${path}`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["security-control"] }); toast.success("Action recorded"); },
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Security Operations" title="Security operations" description="Event search, incident review and audited session actions. No customer secrets are shown." />
      {query.isLoading ? <LoadingState /> : null}
      {data ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input className="w-64" placeholder="Filter by event type" value={type} onChange={(e) => setType(e.target.value.toUpperCase())} />
            <Button variant="outline" disabled={post.isPending || !type} onClick={() => post.mutate({ path: "incidents", body: { subjectUserId: "unknown", type: type || "MANUAL_REVIEW", summary: "Manual security review opened from operations." } })}>Open incident</Button>
          </div>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Security events</h2>
            {data.events.length === 0 ? <p className="text-xs text-slate-500">No events.</p> : data.events.map((event) => (
              <div key={event.id} className="flex flex-wrap justify-between border-b border-border/70 py-1 text-xs">
                <span>{event.type} Â· {event.sourceModule}</span><span className="text-slate-500">{new Date(event.occurredAt).toLocaleString("en-IN")}</span>
              </div>
            ))}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Incidents</h2>
            {data.incidents.length === 0 ? <p className="text-xs text-slate-500">No incidents.</p> : data.incidents.map((incident) => (
              <div key={incident.id} className="flex flex-wrap justify-between border-b border-border/70 py-1 text-xs">
                <span>{incident.type} Â· {incident.status} Â· {incident.summary}</span>
                <Button size="sm" variant="outline" disabled={post.isPending} onClick={() => post.mutate({ path: `incidents/${incident.id}/resolve`, body: { reason: "Reviewed and resolved in operations." } })}>Resolve</Button>
              </div>
            ))}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Recovery & deletion reviews</h2>
            {data.recoveryRequests.map((r) => <p key={r.id} className="py-1 text-xs">Recovery {r.id} Â· {r.status}</p>)}
            {data.deletionRequests.map((r) => (
              <div key={r.id} className="flex justify-between py-1 text-xs"><span>Deletion {r.id} Â· {r.status}</span><Button size="sm" variant="outline" disabled={post.isPending} onClick={() => post.mutate({ path: `deletions/${r.id}/review`, body: { decision: "REJECTED", reason: "Insufficient verification." } })}>Reject</Button></div>
            ))}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Administrative actions</h2>
            {data.actions.map((a) => <p key={a.id} className="py-1 text-xs">{a.action} Â· {a.targetType} Â· {a.reason}</p>)}
          </section>
          <p className="text-xs text-slate-500">{data.notice}</p>
        </div>
      ) : null}
    </div>
  );
}
