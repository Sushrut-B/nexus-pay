"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { BillingOccurrenceView, InvoiceView, SubscriptionView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export function SubscriptionPortalView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const subscription = useQuery({ queryKey: ["subscription", id], queryFn: () => apiFetch<SubscriptionView>(`/api/subscriptions/${encodeURIComponent(id)}`) });
  const invoices = useQuery({ queryKey: ["subscription-invoices", id], queryFn: () => apiFetch<{ items: InvoiceView[] }>(`/api/subscriptions/${encodeURIComponent(id)}/invoices`) });
  const occurrences = useQuery({ queryKey: ["subscription-occurrences", id], queryFn: () => apiFetch<{ items: BillingOccurrenceView[] }>(`/api/subscriptions/${encodeURIComponent(id)}/occurrences`) });
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);

  const cancel = useMutation({
    mutationFn: () => apiFetch(`/api/subscriptions/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ timing: "END_OF_PERIOD", reason }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["subscription", id] });
      toast.success("Cancellation requested");
      setConfirm(false);
    },
    onError: (failure) => toast.error(failure instanceof ApiClientError ? failure.message : "Could not request cancellation"),
  });

  const data = subscription.data;
  const statusMessage = (status: string): string => {
    switch (status) {
      case "ACTIVE": return "Your subscription is active and will renew on the next billing date.";
      case "TRIALING": return "You are in a free trial. No payment has been collected yet.";
      case "PAST_DUE": return "A renewal payment needs your attention. No new charge has been made.";
      case "CANCELLATION_SCHEDULED": return "Your subscription will end at the close of the current billing period.";
      case "CANCELLED": return "This subscription is cancelled. No further payments will be collected.";
      case "PAUSED": return "This subscription is paused and will not be billed until resumed.";
      default: return "Your subscription is being set up.";
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Self-service portal</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.planName ?? "Subscription"}</h1>
      </div>
      {data ? (
        <>
          <Alert><AlertDescription>{statusMessage(data.status)}</AlertDescription></Alert>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Status" value={data.status.replaceAll("_", " ")} />
            <Metric label="Amount" value={formatMoney(data.pricingSnapshot.amountMinor, data.pricingSnapshot.currency)} />
            <Metric label="Next billing" value={data.nextBillingDate ? formatDateTime(data.nextBillingDate) : "—"} />
            <Metric label="Trial ends" value={data.trialEndDate ? formatDateTime(data.trialEndDate) : "—"} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Invoices & receipts</CardTitle></CardHeader>
            <CardContent>
              {(invoices.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No invoices yet.</p> : (
                <div className="divide-y divide-border/70">
                  {invoices.data?.items.map((invoice) => (
                    <div key={invoice.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <span className="font-mono">{invoice.invoiceNumber}</span>
                      <span className="text-muted-foreground">{formatDateTime(invoice.issueDate)} · {invoice.status}</span>
                      <span className="font-semibold">{formatMoney(invoice.totalMinor, invoice.currency)}</span>
                      <Button size="sm" variant="ghost" asChild><a href={`/api/invoices/${encodeURIComponent(invoice.id)}/pdf`} download>PDF</a></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Renewal attempts</CardTitle></CardHeader>
            <CardContent>
              {(occurrences.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No renewal attempts yet.</p> : (
                <div className="divide-y divide-border/70">
                  {occurrences.data?.items.slice(0, 12).map((occurrence) => (
                    <div key={occurrence.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                      <span>#{occurrence.occurrenceNumber} · {formatDateTime(occurrence.createdAt)}</span>
                      <span>{occurrence.status}{occurrence.failureCategory ? ` · ${occurrence.failureCategory.replaceAll("_", " ")}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {!["CANCELLED", "EXPIRED", "CANCELLATION_SCHEDULED"].includes(data.status) ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Cancel subscription</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Cancellation takes effect at the end of the current billing period. No further payments will be collected after that date.</p>
                {confirm ? (
                  <>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Confirm cancellation</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep subscription</Button>
                    </div>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Request cancellation</Button>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-semibold text-navy">{value}</p></div>;
}
