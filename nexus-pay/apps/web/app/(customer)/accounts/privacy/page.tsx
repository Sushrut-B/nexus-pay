"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { PrivacyDataView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function PrivacyPage() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ["accounts", "privacy"], queryFn: () => apiFetch<PrivacyDataView>("/api/privacy/data-access") });
  const [reason, setReason] = useState("");
  const request = useMutation({
    mutationFn: () => apiFetch("/api/privacy/data-deletion-request", { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { setReason(""); void queryClient.invalidateQueries({ queryKey: ["accounts", "privacy"] }); toast.success("Deletion request recorded"); },
    onError: () => toast.error("Could not record request"),
  });
  const view = data.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Privacy centre</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Your financial data</h1>
      </div>
      {view ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Active consents" value={String(view.activeConsents)} />
            <Metric label="Revoked consents" value={String(view.revokedConsents)} />
            <Metric label="Data categories" value={String(view.dataCategories.length)} />
            <Metric label="Last retrieval" value={view.lastRetrievalAt ? formatDateTime(view.lastRetrievalAt) : "—"} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Retention</CardTitle></CardHeader>
            <CardContent><p className="text-xs text-muted-foreground">{view.retentionNotice}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Request data deletion</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for deletion request" aria-label="Reason" />
              <Button size="sm" disabled={reason.length < 5 || request.isPending} onClick={() => request.mutate()}>Submit request</Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-semibold text-navy">{value}</p></div>;
}
