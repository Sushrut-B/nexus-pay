"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@nexus/ui";
import type { SavingsGoalListResult, SavingsGoalView } from "@nexus/shared-types";
import { CONTRIBUTION_TYPES, SAVINGS_GOAL_STATUS_LABELS, type ContributionType } from "@nexus/shared-types";
import { Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";

export function SavingsView() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [description, setDescription] = useState("");
  const [contributionGoal, setContributionGoal] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<ContributionType>("RECORDED");
  const [error, setError] = useState<string | null>(null);

  const goals = useQuery({
    queryKey: ["finance", "goals"],
    queryFn: () => apiFetch<SavingsGoalListResult>("/api/savings/goals"),
  });

  const create = useMutation({
    mutationFn: () => {
      const parsed = Number(target);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed * 100)) {
        throw new Error("Enter a valid target amount.");
      }
      return apiFetch("/api/savings/goals", {
        method: "POST",
        body: JSON.stringify({
          name,
          targetAmountMinor: Math.round(parsed * 100),
          description: description.trim() || undefined,
          targetDate: targetDate ? new Date(`${targetDate}T23:59:59.000Z`).toISOString() : undefined,
        }),
      });
    },
    onSuccess: () => {
      setShowForm(false);
      setName(""); setTarget(""); setTargetDate(""); setDescription(""); setError(null);
      void queryClient.invalidateQueries({ queryKey: ["finance", "goals"] });
      toast.success("Goal created");
    },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not create goal."),
  });

  const contribute = useMutation({
    mutationFn: () => {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed * 100)) {
        throw new Error("Enter a valid contribution amount.");
      }
      return apiFetch(`/api/savings/goals/${encodeURIComponent(contributionGoal!)}/contributions`, {
        method: "POST",
        body: JSON.stringify({ amountMinor: Math.round(parsed * 100), contributionType: type }),
      });
    },
    onSuccess: () => {
      setContributionGoal(null); setAmount(""); setError(null);
      void queryClient.invalidateQueries({ queryKey: ["finance", "goals"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Contribution recorded");
    },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not record contribution."),
  });

  const updateGoal = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "PAUSED" | "ACTIVE" | "COMPLETED" }) =>
      apiFetch(`/api/savings/goals/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["finance", "goals"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Savings goals</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Save for what matters.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Goals track progress. Contributions are planning records — no wallet money moves automatically.
          </p>
        </div>
        <Button onClick={() => setShowForm((value) => !value)}><Plus className="h-4 w-4" aria-hidden="true" /> New goal</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create a savings goal</CardTitle>
            <CardDescription>Set a target and an optional target date.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="goal-name">Goal name</Label>
                <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Emergency fund" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="goal-target">Target amount (INR)</Label>
                <Input id="goal-target" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="50000" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="goal-date">Target date (optional)</Label>
                <Input id="goal-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="goal-description">Description (optional)</Label>
                <Input id="goal-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} className="mt-1.5" />
              </div>
            </div>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create goal</Button>
          </CardContent>
        </Card>
      ) : null}

      {(goals.data?.items ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Target className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No savings goals yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Create a goal and record planned or completed contributions.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {goals.data?.items.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onContribute={() => { setContributionGoal(goal.id); setAmount(""); setError(null); }}
              onPause={() => updateGoal.mutate({ id: goal.id, status: goal.status === "PAUSED" ? "ACTIVE" : "PAUSED" })}
              onComplete={() => updateGoal.mutate({ id: goal.id, status: "COMPLETED" })}
            />
          ))}
        </div>
      )}

      {contributionGoal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">Record a contribution</CardTitle>
              <CardDescription>This is a planning entry. It does not transfer money or change your wallet balance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="contribution-amount">Amount (INR)</Label>
                <Input id="contribution-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1000" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="contribution-type">Type</Label>
                <select id="contribution-type" value={type} onChange={(e) => setType(e.target.value as ContributionType)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {CONTRIBUTION_TYPES.map((value) => (
                    <option key={value} value={value}>{value === "RECORDED" ? "Recorded (counts toward progress)" : "Planned (does not count yet)"}</option>
                  ))}
                </select>
              </div>
              {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setContributionGoal(null)}>Cancel</Button>
                <Button className="flex-1" disabled={contribute.isPending} onClick={() => contribute.mutate()}>Save contribution</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function GoalCard({
  goal,
  onContribute,
  onPause,
  onComplete,
}: {
  goal: SavingsGoalView;
  onContribute: () => void;
  onPause: () => void;
  onComplete: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{goal.name}</CardTitle>
          <CardDescription>
            {goal.targetDate ? `Target ${formatDate(goal.targetDate)}` : "No target date"}
          </CardDescription>
        </div>
        <Badge variant={goal.status === "COMPLETED" ? "success" : goal.status === "PAUSED" ? "secondary" : "info"}>
          {SAVINGS_GOAL_STATUS_LABELS[goal.status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between">
          <p className="font-display text-2xl font-semibold text-navy">{formatMoney(goal.recordedMinor, goal.currency)}</p>
          <p className="text-xs text-muted-foreground">of {formatMoney(goal.targetAmountMinor, goal.currency)}</p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, goal.progress)}%` }} />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{goal.progress}% complete</span>
          <span>{formatMoney(goal.remainingMinor, goal.currency)} remaining</span>
        </div>
        {goal.plannedMinor > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Plus {formatMoney(goal.plannedMinor, goal.currency)} planned (not counted).
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {goal.status === "ACTIVE" ? (
            <>
              <Button size="sm" onClick={onContribute}>Add contribution</Button>
              <Button size="sm" variant="outline" onClick={onPause}>Pause</Button>
              <Button size="sm" variant="ghost" onClick={onComplete}>Complete</Button>
            </>
          ) : goal.status === "PAUSED" ? (
            <Button size="sm" variant="outline" onClick={onPause}>Resume</Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
