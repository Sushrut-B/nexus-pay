"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState, StatusPill } from "@/components/control/ui";

interface Row {
  id: string;
  planName: string;
  merchantName: string;
  customerName: string;
  customerEmail: string;
  status: string;
  amountMinor: number;
  currency: string;
  nextBillingDate: string | null;
  occurrenceCount: number;
  createdAt: string;
}

export default function ControlSubscriptionsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const subscriptions = useQuery({
    queryKey: ["control", "subscriptions", query, status],
    queryFn: () => apiFetch<{ items: Row[] }>(
      `/api/control/subscriptions?q=${encodeURIComponent(query)}${status ? `&status=${encodeURIComponent(status)}` : ""}`,
    ),
  });

  const rows = (subscriptions.data?.items ?? []).filter((row) =>
    !query || `${row.planName} ${row.merchantName} ${row.customerEmail}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div>
      <ControlPageHeader
        eyebrow="Ecosystem"
        title="Subscriptions"
        description="Recurring subscriptions across all merchants. Read-only; no wallet balances are exposed."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plan, merchant or customer" aria-label="Search subscriptions" className="h-9 w-72" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Subscription status" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          <option value="">All statuses</option>
          {["PENDING", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLATION_SCHEDULED", "CANCELLED", "EXPIRED", "INCOMPLETE", "REQUIRES_CUSTOMER_ACTION"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </select>
      </div>
      {subscriptions.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">All subscriptions</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? <p className="py-10 text-center text-xs text-slate-500">No subscriptions found.</p> : (
            <div className="divide-y divide-slate-100">
              {rows.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-900">{row.planName} <span className="text-slate-400">· {row.merchantName}</span></p>
                    <p className="text-[10px] text-slate-500">{row.customerName} · {row.customerEmail} · {formatDateTime(row.createdAt)}</p>
                  </div>
                  <StatusPill state={row.status.replaceAll("_", " ")} tone={row.status === "ACTIVE" ? "healthy" : ["PAST_DUE", "REQUIRES_CUSTOMER_ACTION"].includes(row.status) ? "critical" : "warning"} />
                  <p className="text-xs font-semibold">{formatMoney(row.amountMinor, row.currency)}</p>
                  <p className="w-32 text-right text-[10px] text-slate-500">{row.nextBillingDate ? `Next ${formatDateTime(row.nextBillingDate)}` : `${row.occurrenceCount} periods`}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
