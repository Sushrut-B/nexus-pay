"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState, StatusPill } from "@/components/control/ui";

interface Metrics {
  subscriptions: { total: number; active: number; trialing: number; pastDue: number; cancelled: number };
  occurrences: { settled: number; failed: number; deadLettered: number; unresolved: number };
  invoices: { outstandingMinor: number; outstandingCount: number };
  merchantsWithSubscriptions: number;
}

interface InvoiceRow {
  id: string; invoiceNumber: string; merchantName: string; customerName: string;
  customerEmail: string; status: string; totalMinor: number; currency: string;
  paymentRef: string | null; issueDate: string;
}

export default function ControlBillingPage() {
  const [status, setStatus] = useState("");
  const metrics = useQuery({ queryKey: ["control", "billing-metrics"], queryFn: () => apiFetch<Metrics>("/api/control/billing-metrics") });
  const invoices = useQuery({
    queryKey: ["control", "subscription-invoices", status],
    queryFn: () => apiFetch<{ items: InvoiceRow[] }>(`/api/control/subscription-invoices${status ? `?status=${status}` : ""}`),
  });

  return (
    <div>
      <ControlPageHeader
        eyebrow="Ecosystem"
        title="Billing operations"
        description="Platform-wide subscription and invoice monitoring. No privileged settlement actions are available here."
      />
      {metrics.isLoading ? <LoadingState /> : null}
      {metrics.data ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Total subscriptions" value={String(metrics.data.subscriptions.total)} />
          <Metric label="Active" value={String(metrics.data.subscriptions.active)} />
          <Metric label="Past due" value={String(metrics.data.subscriptions.pastDue)} />
          <Metric label="Unresolved outcomes" value={String(metrics.data.occurrences.unresolved)} />
          <Metric label="Settled renewals" value={String(metrics.data.occurrences.settled)} />
          <Metric label="Failed renewals" value={String(metrics.data.occurrences.failed)} />
          <Metric label="Outstanding invoices" value={formatMoney(metrics.data.invoices.outstandingMinor, "INR")} />
          <Metric label="Merchants with subscriptions" value={String(metrics.data.merchantsWithSubscriptions)} />
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Invoices</CardTitle>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Invoice status" className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">All statuses</option>
            {["OPEN", "PAID", "PAST_DUE", "VOID", "DRAFT", "PROCESSING"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </CardHeader>
        <CardContent>
          {(invoices.data?.items ?? []).length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">No invoices found.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {invoices.data?.items.slice(0, 100).map((invoice) => (
                <div key={invoice.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-medium text-slate-900">{invoice.invoiceNumber} <span className="text-slate-400">· {invoice.merchantName}</span></p>
                    <p className="text-[10px] text-slate-500">{invoice.customerEmail} · {formatDateTime(invoice.issueDate)}</p>
                  </div>
                  <StatusPill state={invoice.status} tone={invoice.status === "PAID" ? "healthy" : invoice.status === "PAST_DUE" ? "critical" : "warning"} />
                  <p className="text-xs font-semibold">{formatMoney(invoice.totalMinor, invoice.currency)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}
