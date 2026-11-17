"use client";

import { useState } from "react";
import Link from "next/link";
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
import type {
  ActivityListResult,
  ExpenseListResult,
  GroupBalances,
  GroupDetail,
  SettlementListResult,
  SuggestedSettlement,
} from "@nexus/shared-types";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  GROUP_CATEGORY_LABELS,
  SETTLEMENT_STATUS_LABELS,
  SPLIT_METHODS,
  SPLIT_METHOD_LABELS,
  parseMajorToMinor,
  type SplitMethod,
} from "@nexus/shared-types";
import { ArrowLeft, ArrowRight, Plus, Receipt, Users } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDate, formatDateTime, formatMoney, initials, relativeTime } from "@/lib/format";

type Tab = "expenses" | "balances" | "activity" | "settlements";

function toMinorOrZero(value: string): number {
  const parsed = parseMajorToMinor(value);
  return parsed.ok ? parsed.amountMinor : 0;
}

export function GroupDetailView({
  initialGroup,
  initialExpenses,
  initialBalances,
  initialSuggestions,
  initialSettlements,
  initialActivity,
  viewerId,
}: {
  initialGroup: GroupDetail;
  initialExpenses: ExpenseListResult;
  initialBalances: GroupBalances;
  initialSuggestions: SuggestedSettlement[];
  initialSettlements: SettlementListResult;
  initialActivity: ActivityListResult;
  viewerId: string;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("expenses");
  const [showExpense, setShowExpense] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("FOOD");
  const [paidBy, setPaidBy] = useState(viewerId);
  const [method, setMethod] = useState<SplitMethod>("EQUAL");
  const [selected, setSelected] = useState<string[]>(initialGroup.members.filter((m) => !m.removedAt).map((m) => m.userId));
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [memberQuery, setMemberQuery] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const groupId = initialGroup.id;
  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => apiFetch<GroupDetail>(`/api/groups/${encodeURIComponent(groupId)}`),
    initialData: initialGroup,
  });
  const expenses = useQuery({
    queryKey: ["group", groupId, "expenses"],
    queryFn: () => apiFetch<ExpenseListResult>(`/api/groups/${encodeURIComponent(groupId)}/expenses`),
    initialData: initialExpenses,
  });
  const balances = useQuery({
    queryKey: ["group", groupId, "balances"],
    queryFn: () => apiFetch<GroupBalances>(`/api/groups/${encodeURIComponent(groupId)}/balances`),
    initialData: initialBalances,
  });
  const suggestions = useQuery({
    queryKey: ["group", groupId, "suggestions"],
    queryFn: () => apiFetch<SuggestedSettlement[]>(`/api/groups/${encodeURIComponent(groupId)}/suggested-settlements`),
    initialData: initialSuggestions,
  });
  const settlements = useQuery({
    queryKey: ["group", groupId, "settlements"],
    queryFn: () => apiFetch<SettlementListResult>(`/api/groups/${encodeURIComponent(groupId)}/settlements`),
    initialData: initialSettlements,
  });
  const activity = useQuery({
    queryKey: ["group", groupId, "activity"],
    queryFn: () => apiFetch<ActivityListResult>(`/api/groups/${encodeURIComponent(groupId)}/activity`),
    initialData: initialActivity,
  });

  const refreshAll = () => {
    for (const key of ["group", "expenses", "balances", "suggestions", "settlements", "activity"]) {
      void queryClient.invalidateQueries({ queryKey: ["group", groupId, key] });
    }
    void queryClient.invalidateQueries({ queryKey: ["groups"] });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const addExpense = useMutation({
    mutationFn: () => {
      const parsed = parseMajorToMinor(amount);
      if (!parsed.ok) throw new Error("Enter a valid expense amount.");
      if (selected.length === 0) throw new Error("Select at least one participant.");
      return apiFetch(`/api/groups/${encodeURIComponent(groupId)}/expenses`, {
        method: "POST",
        body: JSON.stringify({
          title,
          totalAmountMinor: parsed.amountMinor,
          category,
          expenseDate: date,
          paidByUserId: paidBy,
          splitMethod: method,
          participants: selected.map((userId) => ({
            userId,
            ...(method === "CUSTOM" ? { amountMinor: toMinorOrZero(allocations[userId] ?? "") } : {}),
            ...(method === "PERCENTAGE" ? { percentage: Number(allocations[userId] ?? 0) } : {}),
            ...(method === "SHARES" ? { shares: Number(allocations[userId] ?? 0) } : {}),
          })),
        }),
      });
    },
    onSuccess: () => {
      setShowExpense(false);
      setTitle("");
      setAmount("");
      setAllocations({});
      setFormError(null);
      refreshAll();
      toast.success("Expense added and balances updated.");
    },
    onError: (error) =>
      setFormError(error instanceof ApiClientError || error instanceof Error ? error.message : "Could not add the expense."),
  });

  const addMember = useMutation({
    mutationFn: () => apiFetch(`/api/groups/${encodeURIComponent(groupId)}/members`, {
      method: "POST",
      body: JSON.stringify({ query: memberQuery }),
    }),
    onSuccess: () => {
      setMemberQuery("");
      refreshAll();
      toast.success("Member added");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not add member."),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        body: "{}",
      }),
    onSuccess: () => {
      refreshAll();
      toast.success("Member removed");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not remove member."),
  });

  const activeMembers = (group.data?.members ?? []).filter((member) => !member.removedAt);
  const myBalance = balances.data?.entries.find((entry) => entry.user.userId === viewerId)?.netMinor ?? 0;
  const isAdmin = group.data?.role === "ADMIN";

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/groups">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All groups
          </Link>
        </Button>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              {GROUP_CATEGORY_LABELS[group.data?.category ?? "OTHER"]} group
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">
              {group.data?.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeMembers.length} members · {isAdmin ? "You administer this group" : "You are a member"}
            </p>
          </div>
          <div className="text-right">
            <p className={`font-display text-2xl font-semibold ${myBalance > 0 ? "text-emerald-700" : myBalance < 0 ? "text-amber-700" : "text-navy"}`}>
              {myBalance === 0 ? "All settled" : `${myBalance > 0 ? "You're owed " : "You owe "}${formatMoney(Math.abs(myBalance), "INR")}`}
            </p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link href={`/groups/${encodeURIComponent(groupId)}/settle`}>
                Settle up
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-secondary/40 p-1">
        {(["expenses", "balances", "activity", "settlements"] as Tab[]).map((value) => (
          <Button key={value} size="sm" variant={tab === value ? "default" : "ghost"} onClick={() => setTab(value)}>
            {value[0]!.toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </div>

      {tab === "expenses" ? (
        <div className="space-y-5">
          <div className="flex justify-end">
            <Button onClick={() => setShowExpense((value) => !value)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add expense
            </Button>
          </div>

          {showExpense ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Record a shared expense</CardTitle>
                <CardDescription>Splits are calculated on the server in integer paise.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="expense-title">Title</Label>
                    <Input id="expense-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner at the beach" className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="expense-amount">Total amount (INR)</Label>
                    <Input id="expense-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="expense-date">Date</Label>
                    <Input id="expense-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="expense-category">Category</Label>
                    <select id="expense-category" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                      {EXPENSE_CATEGORIES.map((value) => <option key={value} value={value}>{EXPENSE_CATEGORY_LABELS[value]}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="expense-payer">Paid by</Label>
                    <select id="expense-payer" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                      {activeMembers.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="expense-method">Split method</Label>
                    <select id="expense-method" value={method} onChange={(e) => { setMethod(e.target.value as SplitMethod); setAllocations({}); }} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                      {SPLIT_METHODS.map((value) => <option key={value} value={value}>{SPLIT_METHOD_LABELS[value]}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <Label>Who shares this?</Label>
                  <div className="mt-2 space-y-2">
                    {activeMembers.map((member) => {
                      const checked = selected.includes(member.userId);
                      return (
                        <div key={member.userId} className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`Include ${member.displayName}`}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, member.userId]
                                  : current.filter((id) => id !== member.userId),
                              )
                            }
                            className="h-4 w-4 accent-[var(--primary)]"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {member.displayName} <span className="text-muted-foreground">@{member.username}</span>
                          </span>
                          {checked && method !== "EQUAL" ? (
                            <Input
                              value={allocations[member.userId] ?? ""}
                              onChange={(event) => setAllocations((current) => ({ ...current, [member.userId]: event.target.value }))}
                              placeholder={method === "CUSTOM" ? "₹0.00" : method === "PERCENTAGE" ? "0" : "1"}
                              className="h-9 w-24 text-xs"
                              aria-label={`${member.displayName} ${method.toLowerCase()}`}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {method === "EQUAL" ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Paise remainders are allocated deterministically; shares always sum to the total.
                    </p>
                  ) : null}
                </div>

                {formError ? <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert> : null}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowExpense(false)}>Cancel</Button>
                  <Button onClick={() => addExpense.mutate()} disabled={addExpense.isPending}>
                    {addExpense.isPending ? "Saving…" : "Save expense"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {expenses.data?.items.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Receipt className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">No expenses yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Add the first shared bill to see who owes what.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {expenses.data?.items.map((expense) => (
                <Card key={expense.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 py-4">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-navy">
                      <Receipt className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{expense.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(expense.expenseDate)} · paid by {expense.payer.displayName} · {SPLIT_METHOD_LABELS[expense.splitMethod]}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatMoney(expense.totalAmountMinor, expense.currency)}</p>
                    <Badge variant="secondary">{expense.splits.length} shares</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "balances" ? (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Who owes whom</CardTitle>
              <CardDescription>Recalculated from expenses and confirmed settlements.</CardDescription>
            </CardHeader>
            <CardContent>
              {balances.data?.entries.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No members in this group.</p>
              ) : (
                <div className="divide-y divide-border/70">
                  {balances.data?.entries.map((entry) => (
                    <div key={entry.user.userId} className="flex items-center gap-3 py-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-xs font-semibold text-navy">
                        {initials(entry.user.displayName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{entry.user.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">@{entry.user.username}</p>
                      </div>
                      <p className={`text-sm font-semibold ${entry.netMinor > 0 ? "text-emerald-700" : entry.netMinor < 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                        {entry.netMinor === 0 ? "Settled" : entry.netMinor > 0 ? `+${formatMoney(entry.netMinor, "INR")}` : `−${formatMoney(Math.abs(entry.netMinor), "INR")}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {balances.data && !balances.data.consistent ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>Group balances failed an internal consistency check. Please refresh.</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Suggested payments</CardTitle>
              <CardDescription>The shortest way to settle everyone up.</CardDescription>
            </CardHeader>
            <CardContent>
              {suggestions.data?.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-emerald-700">
                  Everyone is settled.
                </p>
              ) : (
                <ul className="space-y-3">
                  {suggestions.data?.map((suggestion, index) => (
                    <li key={`${suggestion.payer.userId}-${suggestion.payee.userId}-${index}`} className="rounded-xl border border-border/70 px-3.5 py-3">
                      <p className="text-sm">
                        <span className="font-semibold">{suggestion.payer.displayName}</span> pays{" "}
                        <span className="font-semibold">{suggestion.payee.displayName}</span>
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-sm font-semibold text-primary">{formatMoney(suggestion.amountMinor, "INR")}</p>
                        {suggestion.payer.userId === viewerId ? (
                          <Button asChild size="sm">
                            <Link href={`/groups/${encodeURIComponent(groupId)}/settle?to=${encodeURIComponent(suggestion.payee.userId)}&amount=${suggestion.amountMinor}`}>
                              Pay now
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {isAdmin ? (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" aria-hidden="true" /> Members</CardTitle>
                <CardDescription>Add people by exact Nexus Pay handle, email or mobile number.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {activeMembers.map((member) => (
                    <span key={member.userId} className="flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs">
                      {member.displayName}
                      {member.role === "ADMIN" ? <Badge variant="info">Admin</Badge> : (
                        <button type="button" aria-label={`Remove ${member.displayName}`} onClick={() => removeMember.mutate(member.userId)} className="text-muted-foreground hover:text-destructive">×</button>
                      )}
                    </span>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="@username, email or mobile" className="sm:flex-1" />
                  <Button disabled={memberQuery.trim().length < 3 || addMember.isPending} onClick={() => addMember.mutate()}>Add member</Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "activity" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Group activity</CardTitle>
            <CardDescription>Real events only — created expenses, members and settlements.</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.data?.items.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="space-y-4">
                {activity.data?.items.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <div>
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">{event.actor?.displayName ?? "Nexus Pay"}</span>{" "}
                        {event.eventType.toLowerCase().replaceAll("_", " ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {relativeTime(event.createdAt)} · {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "settlements" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settlements</CardTitle>
            <CardDescription>Only verified payments reduce what people owe.</CardDescription>
          </CardHeader>
          <CardContent>
            {settlements.data?.items.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No settlements recorded yet.</p>
            ) : (
              <div className="divide-y divide-border/70">
                {settlements.data?.items.map((settlement) => (
                  <div key={settlement.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {settlement.payer.displayName} → {settlement.payee.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(settlement.createdAt)}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatMoney(settlement.amountMinor, settlement.currency)}</p>
                    <Badge variant={settlement.status === "SETTLED" ? "success" : settlement.status === "FAILED" ? "danger" : "warning"}>
                      {SETTLEMENT_STATUS_LABELS[settlement.status]}
                    </Badge>
                    {settlement.paymentRef ? (
                      <Link href={`/transactions/${encodeURIComponent(settlement.paymentRef)}`} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">
                        Receipt
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
