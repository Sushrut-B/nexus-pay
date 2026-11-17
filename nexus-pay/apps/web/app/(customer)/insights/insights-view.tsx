"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  Spinner,
} from "@nexus/ui";
import type { FinanceOverview, InsightPeriod } from "@nexus/shared-types";
import { CATEGORY_TYPE_LABELS, INSIGHT_PERIODS } from "@nexus/shared-types";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Lightbulb, Wallet } from "lucide-react";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";

const PERIOD_LABELS: Record<InsightPeriod, string> = {
  month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
  year: "This year",
  custom: "Custom",
};

const CHART_COLORS = [
  "#2563eb",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#0369a1",
  "#4d7c0f",
  "#a16207",
  "#9333ea",
  "#0891b2",
];

export function InsightsView({ displayName }: { displayName: string }) {
  const [period, setPeriod] = useState<InsightPeriod>("month");

  const overview = useQuery({
    queryKey: ["insights", "overview", period],
    queryFn: () => apiFetch<FinanceOverview>(`/api/insights/overview?period=${period}`),
  });

  const data = overview.data;
  const hasActivity = (data?.transactionCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Personal finance
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
            Your money, {displayName.split(" ")[0]}.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every figure below comes from verified Raftline transactions. Nothing is estimated.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-secondary/40 p-1">
          {INSIGHT_PERIODS.filter((value) => value !== "custom").map((value) => (
            <Button
              key={value}
              size="sm"
              variant={period === value ? "default" : "ghost"}
              onClick={() => setPeriod(value)}
            >
              {PERIOD_LABELS[value]}
            </Button>
          ))}
        </div>
      </div>

      {overview.isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
            <Spinner /> Calculating your insights…
          </CardContent>
        </Card>
      ) : null}

      {overview.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {overview.error instanceof ApiClientError
              ? overview.error.message
              : "We could not calculate your insights. Please try again."}
          </AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryTile label="Money received" value={data.receivedMinor} tone="positive" icon={<ArrowDownLeft className="h-4 w-4" />} />
            <SummaryTile label="Money sent" value={data.sentMinor} tone="neutral" icon={<ArrowUpRight className="h-4 w-4" />} />
            <SummaryTile label="Eligible spending" value={data.expenseMinor} tone="warning" icon={<Wallet className="h-4 w-4" />} />
            <SummaryTile label="Net cash flow" value={data.netCashFlowMinor} tone={data.netCashFlowMinor >= 0 ? "positive" : "warning"} icon={<ArrowRight className="h-4 w-4" />} />
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Current wallet balance
              </p>
              <p className="mt-2 font-display text-2xl font-semibold text-navy">
                {data.walletBalanceMinor === null ? "Unavailable" : formatMoney(data.walletBalanceMinor, "INR")}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Live from Raftline</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Savings estimate
              </p>
              <p className="mt-2 font-display text-2xl font-semibold text-navy">
                {data.savingsEstimateMinor === null
                  ? "Not enough data"
                  : formatMoney(data.savingsEstimateMinor, "INR")}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Positive net cash flow with both inflows and outflows
              </p>
            </div>
          </div>

          {!hasActivity ? (
            <Card>
              <CardContent className="py-14 text-center">
                <Wallet className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">No confirmed activity for this period</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  Once you send or receive money, verified analytics will appear here automatically.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button asChild size="sm"><Link href="/send">Send money</Link></Button>
                  <Button asChild size="sm" variant="outline"><Link href="/receive">Receive money</Link></Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Income vs. spending</CardTitle>
                    <CardDescription>Buckets over {data.period.label.toLowerCase()}</CardDescription>
                  </CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.cashFlow}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value: unknown) => formatMoney(Number(value ?? 0), "INR")} />
                        <Legend />
                        <Bar dataKey="inflowMinor" name="Received" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="outflowMinor" name="Sent" fill="#b45309" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Spending by category</CardTitle>
                    <CardDescription>Eligible spending only — transfers are excluded</CardDescription>
                  </CardHeader>
                  <CardContent className="h-64">
                    {data.categoryBreakdown.length === 0 ? (
                      <p className="grid h-full place-items-center text-xs text-muted-foreground">
                        No categorized spending yet.
                      </p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data.categoryBreakdown}
                            dataKey="amountMinor"
                            nameKey="categoryName"
                            innerRadius="45%"
                            outerRadius="75%"
                            paddingAngle={2}
                          >
                            {data.categoryBreakdown.map((entry, index) => (
                              <Cell key={entry.categoryId} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: unknown) => formatMoney(Number(value ?? 0), "INR")} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Weekly cash flow</CardTitle>
                    <CardDescription>Net movement over the last eight weeks</CardDescription>
                  </CardHeader>
                  <CardContent className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.weekly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: unknown) => formatMoney(Number(value ?? 0), "INR")} />
                        <Area type="monotone" dataKey="netMinor" name="Net cash flow" stroke="#2563eb" fill="#dbeafe" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Daily spending activity</CardTitle>
                    <CardDescription>Sent amounts over the last 30 days</CardDescription>
                  </CardHeader>
                  <CardContent className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.daily}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: unknown) => formatMoney(Number(value ?? 0), "INR")} />
                        <Bar dataKey="outflowMinor" name="Spent" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <Card>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="text-base">Category breakdown</CardTitle>
                      <CardDescription>From actual categorized transactions</CardDescription>
                    </div>
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/insights/spending">Details <ArrowRight className="h-3.5 w-3.5" /></Link>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {data.categoryBreakdown.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">
                        Assign categories to see a breakdown.
                      </p>
                    ) : (
                      <div className="divide-y divide-border/70">
                        {data.categoryBreakdown.map((entry) => (
                          <div key={entry.categoryId} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {CATEGORY_TYPE_LABELS[entry.categoryType]}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {entry.transactionCount} transactions · {entry.percentage}%
                              </p>
                            </div>
                            <p className="text-sm font-semibold tabular-nums">
                              {formatMoney(entry.amountMinor, "INR")}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-primary" aria-hidden="true" /> What we noticed
                    </CardTitle>
                    <CardDescription>Only statements backed by your records</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {data.insights.map((insight, index) => (
                        <li key={`${insight.message}-${index}`} className="flex gap-2 text-sm">
                          <Badge variant={insight.type === "warning" ? "warning" : insight.type === "positive" ? "success" : "info"}>
                            {insight.type === "warning" ? "Watch" : insight.type === "positive" ? "Good" : "Note"}
                          </Badge>
                          <span className="text-muted-foreground">{insight.message}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-[11px] text-muted-foreground">
                      Calculated {formatDateTime(data.generatedAt)}.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "positive" | "neutral" | "warning";
  icon: React.ReactNode;
}) {
  const color =
    tone === "positive" ? "text-emerald-700" : tone === "warning" ? "text-amber-700" : "text-navy";
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className={`mt-2 font-display text-2xl font-semibold tabular-nums ${color}`}>
        {formatMoney(value, "INR")}
      </p>
    </div>
  );
}
