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
import type { BudgetListResult, BudgetView, CategoryView } from "@nexus/shared-types";
import {
  BUDGET_PERIOD_TYPES,
  BUDGET_STATUS_LABELS,
  BUDGET_THRESHOLDS,
  type BudgetPeriodType,
} from "@nexus/shared-types";
import { Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";

interface CategoriesResponse { categories: CategoryView[] }

export function BudgetsView() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [periodType, setPeriodType] = useState<BudgetPeriodType>("MONTHLY");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [thresholds, setThresholds] = useState<number[]>([...BUDGET_THRESHOLDS]);
  const [error, setError] = useState<string | null>(null);

  const budgets = useQuery({
    queryKey: ["finance", "budgets"],
    queryFn: () => apiFetch<BudgetListResult>("/api/budgets"),
  });
  const categories = useQuery({
    queryKey: ["finance", "categories"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/transactions/categories"),
  });

  const create = useMutation({
    mutationFn: () => {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed * 100)) {
        throw new Error("Enter a valid budget amount with up to two decimals.");
      }
      return apiFetch<BudgetView>("/api/budgets", {
        method: "POST",
        body: JSON.stringify({
          name,
          categoryId,
          amountMinor: Math.round(parsed * 100),
          periodType,
          startDate,
          thresholds,
        }),
      });
    },
    onSuccess: () => {
      setShowForm(false);
      setName("");
      setAmount("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["finance", "budgets"] });
      toast.success("Budget created");
    },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not create budget."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/budgets/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["finance", "budgets"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Budgets</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Spend with intention.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Budgets track eligible categorized spending. They never reserve or move money.
          </p>
        </div>
        <Button onClick={() => setShowForm((value) => !value)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New budget
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create a budget</CardTitle>
            <CardDescription>Choose a category, limit and reporting period.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="budget-name">Budget name</Label>
                <Input id="budget-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly food" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="budget-category">Category</Label>
                <select id="budget-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  <option value="">Choose…</option>
                  {(categories.data?.categories ?? []).map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="budget-amount">Amount (INR)</Label>
                <Input id="budget-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="6000" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="budget-period">Period</Label>
                <select id="budget-period" value={periodType} onChange={(e) => setPeriodType(e.target.value as BudgetPeriodType)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {BUDGET_PERIOD_TYPES.map((value) => (
                    <option key={value} value={value}>{value === "MONTHLY" ? "Monthly" : value === "WEEKLY" ? "Weekly" : "Custom range"}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="budget-start">Start date</Label>
                <Input id="budget-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label>Alert thresholds</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {BUDGET_THRESHOLDS.map((threshold) => (
                    <button
                      key={threshold}
                      type="button"
                      onClick={() =>
                        setThresholds((current) =>
                          current.includes(threshold) ? current.filter((value) => value !== threshold) : [...current, threshold],
                        )
                      }
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                        thresholds.includes(threshold) ? "border-primary bg-accent text-primary" : "border-border"
                      }`}
                    >
                      {threshold}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button disabled={!name.trim() || !categoryId || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create budget"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {(budgets.data?.items ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Target className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No budgets yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Set a category limit and we will track your verified spending against it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {budgets.data?.items.map((budget) => {
            const state =
              budget.status !== "ACTIVE"
                ? BUDGET_STATUS_LABELS[budget.status]
                : budget.utilization >= 100
                  ? "Exceeded"
                  : budget.utilization >= 75
                    ? "Approaching limit"
                    : "Within budget";
            return (
              <Card key={budget.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">{budget.name}</CardTitle>
                    <CardDescription>
                      {budget.category.name} · {budget.periodType.toLowerCase()} · from {formatDate(budget.startDate)}
                    </CardDescription>
                  </div>
                  <Badge variant={budget.utilization >= 100 ? "danger" : budget.utilization >= 75 ? "warning" : "success"}>
                    {state}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-baseline justify-between">
                    <p className="font-display text-2xl font-semibold text-navy">{formatMoney(budget.spentMinor, budget.currency)}</p>
                    <p className="text-xs text-muted-foreground">of {formatMoney(budget.amountMinor, budget.currency)}</p>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${budget.utilization >= 100 ? "bg-destructive" : budget.utilization >= 75 ? "bg-amber-500" : "bg-primary"}`}
                      style={{ width: `${Math.min(100, budget.utilization)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{budget.utilization}% used</span>
                    <span>{formatMoney(budget.remainingMinor, budget.currency)} remaining</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{budget.transactionCount} qualifying transactions</span>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(budget.id)}>Delete</Button>
                  </div>
                  {budget.crossedThresholds.length > 0 ? (
                    <p className="text-[11px] text-amber-700">
                      Alerted at {budget.crossedThresholds.map((value) => `${value}%`).join(", ")}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
