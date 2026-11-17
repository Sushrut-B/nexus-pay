"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { ReconciliationCaseView } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { ControlPageHeader, DataRow, EmptyState, LoadingState, StatusPill } from "@/components/control/ui";

export default function ReconciliationPage() {
  const queryClient = useQueryClient();
  const cases = useQuery({
    queryKey: ["control", "reconciliation"],
    queryFn: () => apiFetch<{ items: ReconciliationCaseView[] }>("/api/control/reconciliation"),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"RESOLVED_SETTLED" | "RESOLVED_REJECTED" | "UNRESOLVED">("UNRESOLVED");

  const investigate = useMutation({
    mutationFn: (id: string) =>
      apiFetch<ReconciliationCaseView>(`/api/control/reconciliation/${encodeURIComponent(id)}/investigate`, {
        method: "POST", body: "{}",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["control", "reconciliation"] });
      toast.success("Evidence retrieved from Raftline");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Investigation failed."),
  });
  const resolve = useMutation({
    mutationFn: (id: string) =>
      apiFetch<ReconciliationCaseView>(`/api/control/reconciliation/${encodeURIComponent(id)}/resolve`, {
        method: "POST", body: JSON.stringify({ decision, reason }),
      }),
    onSuccess: () => {
      setSelected(null); setReason("");
      void queryClient.invalidateQueries({ queryKey: ["control", "reconciliation"] });
      toast.success("Reconciliation decision recorded");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not resolve case."),
  });

  const selectedCase = cases.data?.items.find((item) => item.id === selected);

  return (
    <div>
      <ControlPageHeader eyebrow="Recovery" title="Reconciliation" description="Evidence-based resolution of uncertain payments. No second debit can be created here." />
      {cases.isLoading ? <LoadingState /> : null}
      {(cases.data?.items ?? []).length === 0 && !cases.isLoading ? (
        <EmptyState title="No cases" message="Open a case from a payment investigation to query authoritative evidence." />
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-sm">Cases</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {cases.data?.items.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelected(item.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-slate-900">{item.paymentRef ?? item.paymentIntentId}</p>
                    <p className="text-[10px] text-slate-500">key {item.idempotencyKeyMasked} · {formatDateTime(item.createdAt)}</p>
                  </div>
                  <StatusPill state={item.status.replaceAll("_", " ")} tone={item.status === "RESOLVED_SETTLED" ? "healthy" : "warning"} />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Case detail</CardTitle></CardHeader>
          <CardContent>
            {!selectedCase ? <p className="py-10 text-center text-xs text-slate-500">Select a case to inspect evidence.</p> : (
              <>
                <DataRow label="Application status" value={selectedCase.applicationStatus} />
                <DataRow label="Status" value={selectedCase.status.replaceAll("_", " ")} />
                <DataRow label="Attempts" value={selectedCase.attempts.length} />
                <DataRow label="Evidence" value={JSON.stringify(selectedCase.evidence ?? {}).slice(0, 200)} />
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" disabled={investigate.isPending} onClick={() => investigate.mutate(selectedCase.id)}>
                    Query Raftline evidence
                  </Button>
                </div>
                {!["RESOLVED_SETTLED", "RESOLVED_REJECTED"].includes(selectedCase.status) ? (
                  <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                    <div>
                      <Label htmlFor="reconcile-decision">Decision</Label>
                      <select id="reconcile-decision" value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                        <option value="UNRESOLVED">Remain unresolved</option>
                        <option value="RESOLVED_SETTLED">Resolved: settled</option>
                        <option value="RESOLVED_REJECTED">Resolved: rejected</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="reconcile-reason">Reason</Label>
                      <Input id="reconcile-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Receipt verified by reference" className="mt-1.5" />
                    </div>
                    <Button size="sm" disabled={reason.trim().length < 5 || resolve.isPending} onClick={() => resolve.mutate(selectedCase.id)}>Record decision</Button>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
