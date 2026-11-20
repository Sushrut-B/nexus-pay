"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";
import { useState } from "react";

interface Case { id: string; reference: string; reason: string; status: string; assignedTo: string | null }

export default function BillReconciliationPage() {
  const queryClient = useQueryClient();
  const cases = useQuery({ queryKey: ["control", "billing", "recon"], queryFn: () => apiFetch<{ items: Case[] }>("/api/control/bill-payments/reconciliation") });
  const [assignee, setAssignee] = useState("");
  const assign = useMutation({
    mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string }) => apiFetch(`/api/control/bill-payments/reconciliation/${id}/assign`, { method: "POST", body: JSON.stringify({ assigneeId }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "billing", "recon"] }); },
  });
  const resolve = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/control/bill-payments/reconciliation/${id}/resolve`, { method: "POST", body: JSON.stringify({ resolution: "Verified with provider and Raftline; no balance modified.", outcome: "RESOLVED" }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "billing", "recon"] }); toast.success("Case resolved"); },
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Bill payments" title="Reconciliation queue" description="Investigate unknown outcomes. No operator can change a wallet balance or fabricate provider confirmation." />
      {cases.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Open and investigating cases</CardTitle></CardHeader>
        <CardContent>
          {(cases.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No reconciliation cases.</p> : (
            <div className="divide-y divide-slate-100">
              {cases.data?.items.map((item) => (
                <div key={item.id} className="space-y-2 py-3 text-xs">
                  <div className="flex justify-between"><span>{item.reference} · {item.reason}</span><span className="text-slate-500">{item.status} · {item.assignedTo ?? "unassigned"}</span></div>
                  <div className="flex gap-2">
                    <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Investigator ID" className="h-8 w-56" />
                    <Button size="sm" variant="outline" disabled={!assignee || assign.isPending} onClick={() => assign.mutate({ id: item.id, assigneeId: assignee })}>Assign</Button>
                    <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate(item.id)}>Resolve</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
