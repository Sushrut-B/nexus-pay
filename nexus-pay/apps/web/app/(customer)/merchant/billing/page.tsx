"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { SubscriptionAnalytics } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

interface Recovery {
  failedRenewalCount: number;
  subscriptionsAtRisk: number;
  unresolvedOutcomes: number;
  outstandingInvoices: Array<{ id: string; invoiceNumber: string; totalMinor: number; dueDate: string }>;
}

export default function BillingPage() {
  const [range, setRange] = useState("month");
  const analytics = useQuery({
    queryKey: ["merchant", "billing-analytics", range],
    queryFn: () => apiFetch<SubscriptionAnalytics>(`/api/merchant/billing/analytics?range=${range}`),
  });
  const recovery = useQuery({ queryKey: ["merchant", "billing-recovery"], queryFn: () => apiFetch<Recovery>("/api/merchant/billing/recovery") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/merchant/billing/run", { method: "POST", body: "{}" }),
    onSuccess: () => { toast.success("Billing worker completed"); void analytics.refetch(); void recovery.refetch(); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Worker run failed"),
  });
  const data = analytics.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Recurring revenue</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Billing & recovery</h1>
        </div>
        <div className="flex gap-2">
          <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Range" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
            {[["today", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"], ["90days", "Last 90 days"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run billing worker</Button>
        </div>
      </div>

      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="MRR" value={formatMoney(data.mrrMinor, "INR")} />
          <Metric label="ARR (run-rate)" value={formatMoney(data.arrMinor, "INR")} />
          <Metric label="Active subscriptions" value={String(data.activeSubscriptions)} />
          <Metric label="Churn" value={data.churnRate === null ? "—" : `${data.churnRate}%`} />
          <Metric label="New subscriptions" value={String(data.newSubscriptions)} />
          <Metric label="Cancelled" value={String(data.cancelledSubscriptions)} />
          <Metric label="Failed renewal rate" value={data.failedRenewalRate === null ? "—" : `${data.failedRenewalRate}%`} />
          <Metric label="Outstanding invoices" value={formatMoney(data.outstandingInvoiceMinor, "INR")} />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue recovery</CardTitle></CardHeader>
          <CardContent>
            {recovery.data ? (
              <div className="space-y-3 text-sm">
                <p>Failed renewals: <strong>{recovery.data.failedRenewalCount}</strong></p>
                <p>Subscriptions at risk: <strong>{recovery.data.subscriptionsAtRisk}</strong></p>
                <p>Unresolved outcomes: <strong>{recovery.data.unresolvedOutcomes}</strong></p>
                <p>Outstanding invoices: <strong>{recovery.data.outstandingInvoices.length}</strong></p>
                <Alert><AlertDescription>Retried attempts are never counted as successful payments. Unresolved settlements are reconciled before any new charge.</AlertDescription></Alert>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Metric definitions</CardTitle></CardHeader>
          <CardContent>
            {data ? (
              <div className="max-h-80 space-y-2 overflow-y-auto text-[11px] text-muted-foreground">
                {Object.entries(data.definitions).map(([key, value]) => <p key={key}><strong className="text-foreground">{key}:</strong> {value}</p>)}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
