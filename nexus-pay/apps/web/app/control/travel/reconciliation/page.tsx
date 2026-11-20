"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";

interface Case { id: string; reference: string; reason: string; status: string; assignedTo: string | null }

export default function ControlTravelReconciliationPage() {
  const queryClient = useQueryClient();
  const cases = useQuery({ queryKey: ["control", "travel", "recon"], queryFn: () => apiFetch<{ items: Case[] }>("/api/control/travel/reconciliation") });
  const [assignee, setAssignee] = useState("");
  const assign = useMutation({
    mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string }) => apiFetch(`/api/control/travel/reconciliation/${id}/assign`, { method: "POST", body: JSON.stringify({ assigneeId }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "travel", "recon"] }); },
  });
  const resolve = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/control/travel/reconciliation/${id}/resolve`, { method: "POST", body: JSON.stringify({ resolution: "Verified with provider and Raftline; no balance modified." }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "travel", "recon"] }); toast.success("Case resolved"); },
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Travel" title="Reconciliation queue" description="Investigate unknown outcomes without changing balances or fabricating confirmations." />
      {cases.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Cases</CardTitle></CardHeader>
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
