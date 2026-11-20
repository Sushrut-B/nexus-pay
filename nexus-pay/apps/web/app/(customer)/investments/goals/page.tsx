"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { InvestmentGoalView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function GoalsPage() {
  const queryClient = useQueryClient();
  const goals = useQuery({ queryKey: ["investments", "goals"], queryFn: () => apiFetch<{ items: InvestmentGoalView[] }>("/api/investments/goals") });
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const create = useMutation({
    mutationFn: () => apiFetch("/api/investments/goals", {
      method: "POST", body: JSON.stringify({ name, goalType: "CUSTOM", targetAmountMinor: Number(amount) * 100 }),
    }),
    onSuccess: () => { setName(""); setAmount(""); void queryClient.invalidateQueries({ queryKey: ["investments", "goals"] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Goals</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Investment goals</h1>
      </div>
      <p className="text-xs text-muted-foreground">Recording a contribution is a manual progress entry — never a wallet debit or investment transaction.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">New goal</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="name">Goal name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-48" /></div>
          <div><Label htmlFor="amount">Target (₹)</Label><Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5 w-40" /></div>
          <Button disabled={name.length < 2 || !amount || create.isPending} onClick={() => create.mutate()}>Create goal</Button>
        </CardContent>
      </Card>
      {(goals.data?.items ?? []).length === 0 ? <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">No goals yet.</CardContent></Card> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.data?.items.map((goal) => (
            <Card key={goal.id}>
              <CardHeader><CardTitle className="text-base">{goal.name}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Target: {formatMoney(goal.targetAmountMinor, "INR")}</p>
                <p>Current: {formatMoney(goal.currentAmountMinor, "INR")} · {(goal.progressBps / 100).toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground">Required monthly (assumed): {goal.requiredMonthlyMinor === null ? "—" : formatMoney(goal.requiredMonthlyMinor, "INR")}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
