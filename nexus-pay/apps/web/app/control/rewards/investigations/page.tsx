"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { formatDateTime } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface Row {
  id: string; type: string; subjectId: string; status: string; notes: string | null; createdAt: string;
}

export default function ControlInvestigationsPage() {
  const queryClient = useQueryClient();
  const investigations = useQuery({ queryKey: ["control", "rewards", "investigations"], queryFn: () => apiFetch<{ items: Row[] }>("/api/control/rewards/investigations") });
  const risks = useQuery({ queryKey: ["control", "rewards", "risk-events"], queryFn: () => apiFetch<{ items: Array<{ id: string; reasonCode: string; severity: string; status: string; description: string; createdAt: string }> }>("/api/control/rewards/risk-events") });
  const [form, setForm] = useState({ type: "REWARD_ABUSE", subjectId: "", notes: "", userId: "", points: "", reason: "" });
  const createInvestigation = useMutation({
    mutationFn: () => apiFetch("/api/control/rewards/investigations", {
      method: "POST",
      body: JSON.stringify({ type: form.type, subjectId: form.subjectId, notes: form.notes }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "rewards", "investigations"] }); toast.success("Investigation opened"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Could not open investigation"),
  });
  const adjust = useMutation({
    mutationFn: () => apiFetch("/api/control/rewards/adjustments", {
      method: "POST",
      body: JSON.stringify({ userId: form.userId, points: Number(form.points), reason: form.reason, idempotencyKey: crypto.randomUUID() }),
    }),
    onSuccess: () => toast.success("Manual adjustment recorded"),
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Adjustment failed"),
  });

  return (
    <div>
      <ControlPageHeader eyebrow="Rewards" title="Reward investigations" description="Risk indicators, investigations and controlled manual point adjustments (never wallet funds)." />
      {investigations.isLoading || risks.isLoading ? <LoadingState /> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Risk events</CardTitle></CardHeader>
          <CardContent>
            {(risks.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No risk events.</p> : (
              <div className="divide-y divide-slate-100">
                {risks.data?.items.map((risk) => (
                  <div key={risk.id} className="py-2 text-xs">
                    <p className="font-medium">{risk.reasonCode} · {risk.severity}</p>
                    <p className="text-slate-500">{risk.description} · {formatDateTime(risk.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Open investigation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} placeholder="Subject ID" aria-label="Subject ID" />
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" aria-label="Notes" />
            <Button size="sm" disabled={!form.subjectId || createInvestigation.isPending} onClick={() => createInvestigation.mutate()}>Open investigation</Button>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader><CardTitle className="text-sm">Manual points adjustment</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">Maximum 5,000 points. Adjustments above 1,000 points require SUPER_ADMIN. Wallet funds are never modified.</p>
          <div className="flex flex-wrap gap-2">
            <Input value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} placeholder="User ID" aria-label="User ID" className="h-9 w-56" />
            <Input value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} placeholder="Points (±)" aria-label="Points" className="h-9 w-28" />
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Mandatory reason" aria-label="Reason" className="h-9 w-64" />
            <Button size="sm" disabled={!form.userId || !form.points || form.reason.length < 5 || adjust.isPending} onClick={() => adjust.mutate()}>Apply adjustment</Button>
          </div>
        </CardContent>
      </Card>
      <Card className="mt-5">
        <CardHeader><CardTitle className="text-sm">Investigations</CardTitle></CardHeader>
        <CardContent>
          {(investigations.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No investigations.</p> : (
            <div className="divide-y divide-slate-100">
              {investigations.data?.items.map((row) => (
                <div key={row.id} className="flex items-center justify-between py-2 text-xs">
                  <span>{row.type} · {row.subjectId}</span>
                  <span className="text-slate-500">{row.status} · {formatDateTime(row.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
