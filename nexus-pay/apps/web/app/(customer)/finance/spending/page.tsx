"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { CategorySpendView, FinancePeriod } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function SpendingPage() {
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const categories = useQuery({
    queryKey: ["finance", "categories", period],
    queryFn: () => apiFetch<{ items: CategorySpendView[] }>(`/api/finance/categories?period=${period}`),
  });
  const items = categories.data?.items ?? [];
  const total = items.reduce((sum, item) => sum + item.amountMinor, 0);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Spending intelligence</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Spending breakdown</h1>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value as FinancePeriod)} aria-label="Period" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          {[["week", "This week"], ["month", "This month"], ["last_month", "Last month"], ["quarter", "Last 3 months"], ["year", "This year"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Categories</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No spending recorded in this period.</p> : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.category}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{item.category.replaceAll("_", " ")}</span>
                    <span>{formatMoney(item.amountMinor, "INR")}{item.changeBps !== null ? ` · ${(item.changeBps / 100).toFixed(0)}%` : ""}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (item.amountMinor / Math.max(1, total)) * 100)}%` }} />
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
