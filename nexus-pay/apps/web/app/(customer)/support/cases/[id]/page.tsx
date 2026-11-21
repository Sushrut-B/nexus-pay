"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { SupportCaseDetailView } from "@nexus/shared-types";
import { StatusPill, SupportHeader, SupportNav, SupportNotice } from "@/components/support/support-ui";

export default function SupportCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const query = useQuery({
    queryKey: ["support", "case", params.id],
    queryFn: () => apiFetch<SupportCaseDetailView>(`/api/support/cases/${params.id}`),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["support", "case", params.id] });
  const message = useMutation({
    mutationFn: () => apiFetch(`/api/support/cases/${params.id}/messages`, { method: "POST", body: JSON.stringify({ body: reply, idempotencyKey: `msg-${params.id}-${Date.now()}` }) }),
    onSuccess: () => { setReply(""); invalidate(); },
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!file) return Promise.resolve(null);
      const form = new FormData();
      form.set("file", file);
      return apiFetch(`/api/support/cases/${params.id}/attachments`, { method: "POST", body: form });
    },
    onSuccess: () => { setFile(null); invalidate(); },
  });
  const reopen = useMutation({ mutationFn: () => apiFetch(`/api/support/cases/${params.id}/reopen`, { method: "POST", body: "{}" }), onSuccess: invalidate });
  const c = query.data;
  return (
    <div className="space-y-6">
      <SupportHeader eyebrow="Support Centre" title={c ? `Case ${c.reference}` : "Case details"} description="Case timeline and messages. Internal notes are never shown here." />
      <SupportNav />
      {c ? (
        <>
          <SupportNotice>{c.notice}</SupportNotice>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-4"><p className="text-[11px] uppercase text-muted-foreground">Status</p><StatusPill status={c.status} /></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-[11px] uppercase text-muted-foreground">Priority</p><p className="font-semibold">{c.priority}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-[11px] uppercase text-muted-foreground">Linked record</p><p className="text-sm">{c.linkedSummary ?? "None"}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-[11px] uppercase text-muted-foreground">Authoritative status</p><p className="text-sm">{c.authoritativeStatus ?? "Not applicable"}</p></CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="text-base">Your description</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{c.description}</p>{c.nextAction ? <p className="mt-3 text-xs font-medium text-primary">Next action: {c.nextAction}</p> : null}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader><CardContent>
            {c.events.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No events yet.</p> : c.events.map((event) => (
              <div key={event.id} className="border-b border-border/70 py-2 text-xs last:border-0">
                <span className="font-medium">{event.kind.replaceAll("_", " ")}</span>
                <span className="ml-2 text-muted-foreground">{event.detail}</span>
                <span className="ml-2 text-muted-foreground">Â· {new Date(event.createdAt).toLocaleString("en-IN")}</span>
              </div>
            ))}
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Messages</CardTitle></CardHeader><CardContent>
            {c.messages.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No messages yet.</p> : c.messages.map((m) => (
              <div key={m.id} className="border-b border-border/70 py-3 last:border-0">
                <p className="text-xs font-medium">{m.senderLabel} <span className="text-muted-foreground">Â· {new Date(m.createdAt).toLocaleString("en-IN")}</span></p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
              </div>
            ))}
            <div className="mt-4 flex flex-wrap gap-2">
              <Input className="flex-1" placeholder="Write a reply" value={reply} onChange={(e) => setReply(e.target.value)} />
              <Button disabled={message.isPending || reply.trim().length === 0} onClick={() => message.mutate()}>Send</Button>
            </div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Evidence</CardTitle></CardHeader><CardContent>
            {c.messages.flatMap((m) => m.attachments).length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No evidence attached.</p> : c.messages.flatMap((m) => m.attachments).map((a) => (
              <p key={a.id} className="border-b border-border/70 py-2 text-xs">{a.fileName} Â· {a.contentType} Â· {a.sizeBytes} bytes</p>
            ))}
            <div className="mt-4 flex flex-wrap gap-2">
              <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button disabled={upload.isPending || !file} onClick={() => upload.mutate()}>Upload</Button>
            </div>
          </CardContent></Card>
          {c.resolutionSummary ? <Card><CardHeader><CardTitle className="text-base">Resolution summary</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{c.resolutionSummary}</p></CardContent></Card> : null}
          {["RESOLVED", "CLOSED"].includes(c.status) ? <Button variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate()}>Reopen case</Button> : null}
        </>
      ) : <p className="text-sm text-muted-foreground">Loading caseâ€¦</p>}
    </div>
  );
}
