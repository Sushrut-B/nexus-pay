"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@nexus/ui";
import type {
  CategoryBreakdown,
  FinanceOverview,
  InsightPeriod,
  TransactionSummary,
} from "@nexus/shared-types";
import { CATEGORY_TYPE_LABELS, INSIGHT_PERIODS } from "@nexus/shared-types";
import { ArrowDown, ArrowRight, ArrowUp, Search } from "lucide-react";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { TransactionStatusBadge } from "@/components/payments/status-badge";

interface SpendingAnalytics {
  totalSpentMinor: number;
  previousTotalSpentMinor: number;
  changeMinor: number;
  changePercentage: number | null;
  transactionCount: number;
  period: {
    start: string;
    end: string;
    label: string;
    previousStart: string;
    previousEnd: string;
  };
}

const PERIOD_LABELS: Record<InsightPeriod, string> = {
  month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
  year: "This year",
  custom: "Custom",
};

export function SpendingView() {
  const [period, setPeriod] = useState<InsightPeriod>("month");
  const [selected, setSelected] = useState<CategoryBreakdown | null>(null);
  const [search, setSearch] = useState("");
  const [minMinor, setMinMinor] = useState("");
  const [maxMinor, setMaxMinor] = useState("");

  const spending = useQuery({
    queryKey: ["insights", "spending", period],
    queryFn: () => apiFetch<SpendingAnalytics>(`/api/insights/spending?period=${period}`),
  });
  const overview = useQuery({
    queryKey: ["insights", "overview", period],
    queryFn: () => apiFetch<FinanceOverview>(`/api/insights/overview?period=${period}`),
  });

  const drilldown = useQuery({
    queryKey: ["insights", "transactions", period, selected?.categoryId, search, minMinor, maxMinor],
    queryFn: () => {
      const params = new URLSearchParams({ period, categoryId: selected!.categoryId });
      if (search) params.set("search", search);
      if (minMinor) params.set("minMinor", String(Math.round(Number(minMinor) * 100)));
      if (maxMinor) params.set("maxMinor", String(Math.round(Number(maxMinor) * 100)));
      return apiFetch<{ items: TransactionSummary[] }>(`/api/insights/transactions?${params}`);
    },
    enabled: Boolean(selected),
  });

  const categories = overview.data?.categoryBreakdown ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Spending analytics
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Where your money went.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Transfers between people are not counted as consumption unless you categorize them as spending.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-secondary/40 p-1">
          {INSIGHT_PERIODS.filter((value) => value !== "custom").map((value) => (
            <Button key={value} size="sm" variant={period === value ? "default" : "ghost"} onClick={() => { setPeriod(value); setSelected(null); }}>
              {PERIOD_LABELS[value]}
            </Button>
          ))}
        </div>
      </div>

      {spending.data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric label="Eligible spending" value={spending.data.totalSpentMinor} />
          <Metric label="Previous period" value={spending.data.previousTotalSpentMinor} />
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Period change
            </p>
            <p className="mt-2 flex items-center gap-2 font-display text-2xl font-semibold text-navy">
              {spending.data.changePercentage === null ? (
                "New"
              ) : (
                <>
                  {spending.data.changeMinor >= 0 ? <ArrowUp className="h-5 w-5 text-amber-700" /> : <ArrowDown className="h-5 w-5 text-emerald-700" />}
                  {Math.abs(spending.data.changePercentage)}%
                </>
              )}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {spending.data.changeMinor === 0
                ? "No change"
                : `${formatMoney(Math.abs(spending.data.changeMinor), "INR")} ${spending.data.changeMinor > 0 ? "more" : "less"}`}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Category breakdown</CardTitle>
            <CardDescription>Select a category to see its transactions</CardDescription>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm font-medium">Nothing to break down yet</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  Categorize a transaction to start seeing spending by category.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link href="/transactions/categories">Manage categories</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {categories.map((entry) => (
                  <button
                    key={entry.categoryId}
                    type="button"
                    onClick={() => setSelected(entry)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-secondary/50 ${
                      selected?.categoryId === entry.categoryId ? "border-primary bg-accent/40" : "border-border/70"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{CATEGORY_TYPE_LABELS[entry.categoryType]}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {entry.transactionCount} transactions · {entry.percentage}% of spending
                      </p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, entry.percentage)}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{formatMoney(entry.amountMinor, "INR")}</p>
                      {entry.changePercentage !== null ? (
                        <p className={`text-[11px] ${entry.changeMinor > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                          {entry.changeMinor > 0 ? "+" : ""}{entry.changePercentage}% vs previous
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">New category</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Insights</CardTitle>
            <CardDescription>Based on the selected period only</CardDescription>
          </CardHeader>
          <CardContent>
            {(overview.data?.insights ?? []).length === 0 && !overview.isLoading ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No insights for this period.</p>
            ) : (
              <ul className="space-y-3">
                {overview.data?.insights.map((insight, index) => (
                  <li key={`${insight.message}-${index}`} className="flex gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span className="text-muted-foreground">{insight.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {selected ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">
                Transactions in {CATEGORY_TYPE_LABELS[selected.categoryType]}
              </CardTitle>
              <CardDescription>{selected.transactionCount} matching verified records</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label="Search transactions" className="h-9 w-40 pl-8 text-xs" />
              </div>
              <Input value={minMinor} onChange={(e) => setMinMinor(e.target.value)} placeholder="Min ₹" aria-label="Minimum amount" inputMode="decimal" className="h-9 w-24 text-xs" />
              <Input value={maxMinor} onChange={(e) => setMaxMinor(e.target.value)} placeholder="Max ₹" aria-label="Maximum amount" inputMode="decimal" className="h-9 w-24 text-xs" />
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </CardHeader>
          <CardContent>
            {drilldown.isLoading ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Loading transactions…</p>
            ) : drilldown.data?.items.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No transactions match these filters.</p>
            ) : (
              <div className="divide-y divide-border/70">
                {drilldown.data?.items.map((transaction) => (
                  <div key={transaction.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {transaction.counterpartyName ?? (transaction.kind === "FUNDING" ? "Simulated sandbox funding" : "Nexus Pay customer")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {transaction.description ?? "No note"} · {formatDateTime(transaction.occurredAt)}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">
                      {transaction.direction === "RECEIVED" ? "+" : "−"}{formatMoney(transaction.amountMinor, transaction.currency)}
                    </p>
                    <TransactionStatusBadge status={transaction.status} />
                    {transaction.paymentRef ? (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/transactions/${encodeURIComponent(transaction.paymentRef)}`}>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {spending.isError ? (
        <Alert variant="destructive"><AlertDescription>{spending.error instanceof ApiClientError ? spending.error.message : "Could not load spending analytics."}</AlertDescription></Alert>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-navy">{formatMoney(value, "INR")}</p>
    </div>
  );
}
