"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { ForeignExpenseView } from "@nexus/shared-types";
import { formatByCurrency } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, GlobalNotice, Metric } from "@/components/global/global-ui";

interface Summary { displayCurrency: string; totalConvertedMinor: number; fxFeeMinor: number; byCountry: Record<string, number>; byCurrency: Record<string, number>; byCategory: Record<string, number>; byMonth: Record<string, number>; notice: string }

export default function InternationalExpensesPage() {
  const queryClient = useQueryClient();
  const expenses = useQuery({ queryKey: ["global", "expenses"], queryFn: () => apiFetch<{ expenses: ForeignExpenseView[] }>("/api/global-finance/expenses") });
  const summary = useQuery({ queryKey: ["global", "expense-summary"], queryFn: () => apiFetch<Summary>("/api/global-finance/expenses/summary") });
  const [form, setForm] = useState({ originalMinor: "1000", originalCurrency: "USD", category: "FOOD", merchant: "", country: "US", occurredAt: new Date().toISOString().slice(0, 10) });
  const mutation = useMutation({
    mutationFn: () => apiFetch("/api/global-finance/expenses", { method: "POST", body: JSON.stringify({ ...form, originalMinor: Number(form.originalMinor), occurredAt: new Date(form.occurredAt).toISOString() }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["global", "expenses"] }); void queryClient.invalidateQueries({ queryKey: ["global", "expense-summary"] }); },
  });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="International expenses" description="Track original amount and currency with a clearly labelled converted estimate." />
      <GlobalNav />
      <GlobalNotice>{summary.data?.notice ?? "Foreign transaction fees are shown only when supplied by a source. No imported expense is counted twice."}</GlobalNotice>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Total (est.)" value={summary.data ? formatByCurrency(summary.data.totalConvertedMinor, summary.data.displayCurrency) : "â€”"} />
        <Metric label="Recorded FX fees" value={summary.data ? formatByCurrency(summary.data.fxFeeMinor, summary.data.displayCurrency) : "â€”"} />
        <Metric label="Expenses" value={String((expenses.data?.expenses ?? []).length)} />
      </div>
      <Card><CardHeader><CardTitle className="text-base">Record an expense</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-6">
        <Input placeholder="Minor units" value={form.originalMinor} onChange={(e) => setForm({ ...form, originalMinor: e.target.value })} />
        <Input placeholder="Currency" value={form.originalCurrency} onChange={(e) => setForm({ ...form, originalCurrency: e.target.value.toUpperCase() })} />
        <Input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value.toUpperCase() })} />
        <Input placeholder="Merchant" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} />
        <Input placeholder="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
        <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>Add</Button>
      </CardContent></Card>
      <div className="rounded-2xl border border-border bg-card p-5">
        {(expenses.data?.expenses ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No foreign expenses recorded.</p> : expenses.data?.expenses.map((e) => (
          <div key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-border/70 py-2 text-sm">
            <span>{e.merchant ?? e.category} Â· {e.country}</span>
            <span className="text-muted-foreground">{formatByCurrency(e.originalMinor, e.originalCurrency)} Â· {e.convertedMinor == null ? "No rate" : `â‰ˆ ${formatByCurrency(e.convertedMinor, e.displayCurrency)}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
