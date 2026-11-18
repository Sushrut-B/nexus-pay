"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { GoalView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function FinanceGoalsPage() {
  const queryClient = useQueryClient();
  const goals = useQuery({ queryKey: ["finance", "goals"], queryFn: () => apiFetch<{ items: GoalView[] }>("/api/finance/goals") });
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [contribution, setContribution] = useState<{ id: string; amount: string } | null>(null);
  const create = useMutation({
    mutationFn: () => apiFetch("/api/finance/goals", { method: "POST", body: JSON.stringify({ name, targetAmountMinor: Math.round(Number(amount) * 100), currency: "INR" }) }),
    onSuccess: () => { setName(""); setAmount(""); void queryClient.invalidateQueries({ queryKey: ["finance", "goals"] }); toast.success("Goal created"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create goal"),
  });
  const contribute = useMutation({
    mutationFn: () => apiFetch(`/api/finance/goals/${encodeURIComponent(contribution!.id)}/contributions`, {
      method: "POST",
      body: JSON.stringify({ amountMinor: Math.round(Number(contribution!.amount) * 100), contributionType: "PLANNED" }),
    }),
    onSuccess: () => { setContribution(null); void queryClient.invalidateQueries({ queryKey: ["finance", "goals"] }); toast.success("Planned contribution recorded — no wallet money moved"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record contribution"),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Planning</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Financial goals</h1>
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-5">
          <div><Label htmlFor="goal-name">Goal name</Label><Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-48" /></div>
          <div><Label htmlFor="goal-amount">Target (INR)</Label><Input id="goal-amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5 w-40" /></div>
          <Button disabled={!name || !amount || create.isPending} onClick={() => create.mutate()}>Create goal</Button>
        </CardContent>
      </Card>
      {(goals.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No goals yet.</CardContent></Card> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.data?.items.map((goal) => (
            <Card key={goal.id}>
              <CardHeader><CardTitle className="text-base">{goal.name}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm font-semibold">{formatMoney(goal.recordedMinor, goal.currency)} recorded / {formatMoney(goal.targetMinor, goal.currency)}</p>
                <p className="text-xs text-muted-foreground">{formatMoney(goal.plannedMinor, goal.currency)} planned · {(goal.progressBps / 100).toFixed(0)}% progress · {goal.priority}</p>
                <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, goal.progressBps / 100)}%` }} /></div>
                {contribution?.id === goal.id ? (
                  <div className="flex gap-2">
                    <Input value={contribution.amount} onChange={(e) => setContribution({ ...contribution, amount: e.target.value })} placeholder="Amount (INR)" aria-label="Contribution amount" />
                    <Button size="sm" disabled={contribute.isPending} onClick={() => contribute.mutate()}>Save planned</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setContribution({ id: goal.id, amount: "" })}>Add planned contribution</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
