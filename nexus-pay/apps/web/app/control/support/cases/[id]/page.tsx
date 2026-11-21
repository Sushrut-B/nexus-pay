"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";
import { StatusPill } from "@/components/support/support-ui";

interface StaffCase {
  id: string; reference: string; status: string; priority: string; category: string;
  description: string; linkedSummary: string | null; authoritativeStatus: string | null;
  userId: string; resolutionSummary: string | null;
  messages: Array<{ id: string; body: string; visibility: string; senderLabel: string; senderRole: string; createdAt: string }>;
  events: Array<{ id: string; kind: string; detail: string; customerVisible: boolean; createdAt: string }>;
  linkedOperations: Array<{ id: string; module: string; operationRef: string; authoritativeStatus: string | null; ownerVerified: boolean }>;
  providerInquiries: Array<{ id: string; module: string; status: string }>;
  priorityHistory: Array<{ priority: string; reason: string; changedAt: string }>;
  escalations: Array<{ signal: string; reason: string; createdAt: string }>;
}

export default function StaffCaseWorkspacePage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["support-control", "case", params.id], queryFn: () => apiFetch<StaffCase>(`/api/control/support/cases/${params.id}`) });
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["support-control", "case", params.id] });
  const post = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => apiFetch(`/api/control/support/cases/${params.id}/${path}`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); toast.success("Case updated"); },
  });
  const c = query.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Support Operations" title={c ? `Case ${c.reference}` : "Case workspace"} description="Internal notes remain private. Resolutions never change authoritative financial status." />
      {query.isLoading ? <LoadingState /> : null}
      {c ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={c.status} />
            <Button size="sm" variant="outline" disabled={post.isPending} onClick={() => post.mutate({ path: "status", body: { status: "WAITING_FOR_USER", note: "Additional information requested" } })}>Request info</Button>
            <Button size="sm" variant="outline" disabled={post.isPending} onClick={() => post.mutate({ path: "escalate", body: { reason: "Specialist review required", signal: "SPECIALIST_REVIEW" } })}>Escalate</Button>
            <Button size="sm" variant="outline" disabled={post.isPending} onClick={() => post.mutate({ path: "sync", body: {} })}>Sync linked status</Button>
            <Button size="sm" disabled={post.isPending} onClick={() => post.mutate({ path: "propose", body: { summary: "Proposed resolution after case review.", outcome: "RESOLVED" } })}>Propose resolution</Button>
          </div>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Case details</h2>
            <p className="text-sm">{c.description}</p>
            <p className="mt-2 text-xs text-slate-500">Category {c.category} Â· Priority {c.priority} Â· Linked {c.linkedSummary ?? "none"} Â· Authoritative {c.authoritativeStatus ?? "n/a"}</p>
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Linked operations (read-only)</h2>
            {c.linkedOperations.length === 0 ? <p className="text-xs text-slate-500">No linked operations.</p> : c.linkedOperations.map((l) => (
              <div key={l.id} className="flex justify-between border-b border-border/70 py-1 text-xs"><span>{l.module} Â· {l.operationRef}</span><span>{l.authoritativeStatus ?? "â€”"} {l.ownerVerified ? "Â· owner verified" : ""}</span></div>
            ))}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Messages</h2>
            {c.messages.map((m) => (
              <div key={m.id} className="border-b border-border/70 py-2 text-xs">
                <span className="font-medium">{m.senderLabel}</span> <span className="text-slate-500">[{m.visibility}]</span>
                <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
              </div>
            ))}
            <div className="mt-3 flex gap-2">
              <Input className="flex-1" placeholder="Customer-visible reply" value={message} onChange={(e) => setMessage(e.target.value)} />
              <Button size="sm" disabled={post.isPending || !message} onClick={() => { const body = message; setMessage(""); post.mutate({ path: "messages", body: { body, idempotencyKey: `staffmsg-${params.id}-${Date.now()}` } }); }}>Reply</Button>
            </div>
          </section>
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-amber-900">Internal notes (not customer-visible)</h2>
            {c.messages.filter((m) => m.visibility === "INTERNAL_ONLY").map((m) => <p key={m.id} className="border-b border-amber-200 py-1 text-xs">{m.body}</p>)}
            <div className="mt-3 flex gap-2">
              <Input className="flex-1" placeholder="Internal note" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" variant="outline" disabled={post.isPending || !note} onClick={() => { const body = note; setNote(""); post.mutate({ path: "notes", body: { body, idempotencyKey: `note-${params.id}-${Date.now()}` } }); }}>Add note</Button>
            </div>
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Escalations & priority history</h2>
            {c.escalations.map((e, i) => <p key={i} className="py-1 text-xs">{e.signal} Â· {e.reason}</p>)}
            {c.priorityHistory.map((p, i) => <p key={i} className="py-1 text-xs">Priority {p.priority} Â· {p.reason}</p>)}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Resolve case</h2>
            <Button size="sm" disabled={post.isPending} onClick={() => post.mutate({ path: "resolve", body: { summary: "Case reviewed and resolved through support.", outcome: "RESOLVED" } })}>Mark resolved</Button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
