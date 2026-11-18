"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { BillingOccurrenceView, PlanView, SubscriptionEventView, SubscriptionView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export function SubscriptionDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const subscription = useQuery({ queryKey: ["merchant", "subscription", id], queryFn: () => apiFetch<SubscriptionView>(`/api/merchant/subscriptions/${encodeURIComponent(id)}`) });
  const events = useQuery({ queryKey: ["merchant", "subscription-events", id], queryFn: () => apiFetch<{ items: SubscriptionEventView[] }>(`/api/merchant/subscriptions/${encodeURIComponent(id)}/events`) });
  const occurrences = useQuery({ queryKey: ["merchant", "subscription-occurrences", id], queryFn: () => apiFetch<{ items: BillingOccurrenceView[] }>(`/api/merchant/subscriptions/${encodeURIComponent(id)}/occurrences`) });
  const plans = useQuery({ queryKey: ["merchant", "plans"], queryFn: () => apiFetch<{ items: PlanView[] }>("/api/merchant/plans") });
  const [reason, setReason] = useState("");
  const [targetPlan, setTargetPlan] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["merchant", "subscription", id] });
    void queryClient.invalidateQueries({ queryKey: ["merchant", "subscription-events", id] });
    void queryClient.invalidateQueries({ queryKey: ["merchant", "subscription-occurrences", id] });
  };
  const pause = useMutation({ mutationFn: () => apiFetch(`/api/merchant/subscriptions/${encodeURIComponent(id)}/pause`, { method: "POST", body: "{}" }), onSuccess: () => { invalidate(); toast.success("Subscription paused"); }, onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Could not pause") });
  const resume = useMutation({ mutationFn: () => apiFetch(`/api/merchant/subscriptions/${encodeURIComponent(id)}/resume`, { method: "POST", body: "{}" }), onSuccess: () => { invalidate(); toast.success("Subscription resumed"); }, onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Could not resume") });
  const cancel = useMutation({ mutationFn: () => apiFetch(`/api/merchant/subscriptions/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ timing: "END_OF_PERIOD", reason }) }), onSuccess: () => { invalidate(); toast.success("Cancellation scheduled"); }, onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Could not cancel") });
  const change = useMutation({ mutationFn: () => apiFetch(`/api/merchant/subscriptions/${encodeURIComponent(id)}/plan-change`, { method: "POST", body: JSON.stringify({ planId: targetPlan, reason }) }), onSuccess: () => { invalidate(); toast.success("Plan change scheduled for next period"); }, onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Could not change plan") });

  const data = subscription.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Subscription</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.planName ?? "Subscription"}</h1>
      </div>
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Status" value={data.status.replaceAll("_", " ")} />
            <Metric label="Amount" value={formatMoney(data.pricingSnapshot.amountMinor, data.pricingSnapshot.currency)} />
            <Metric label="Next billing" value={data.nextBillingDate ? formatDateTime(data.nextBillingDate) : "—"} />
            <Metric label="Periods billed" value={String(data.occurrenceCount)} />
          </div>
          <Alert><AlertDescription>Current period: {formatDateTime(data.currentPeriodStart)} → {formatDateTime(data.currentPeriodEnd)}. Pricing snapshot is frozen; plan changes apply at the next billing period only.</AlertDescription></Alert>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" />
                <div className="flex flex-wrap gap-2">
                  {data.status === "ACTIVE" ? <Button size="sm" variant="outline" disabled={pause.isPending} onClick={() => pause.mutate()}>Pause</Button> : null}
                  {data.status === "PAUSED" ? <Button size="sm" variant="outline" disabled={resume.isPending} onClick={() => resume.mutate()}>Resume</Button> : null}
                  {!["CANCELLED", "EXPIRED"].includes(data.status) ? <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel at period end</Button> : null}
                </div>
                <div className="flex gap-2">
                  <select value={targetPlan} onChange={(e) => setTargetPlan(e.target.value)} aria-label="Target plan" className="h-9 flex-1 rounded-lg border border-border bg-background px-2 text-xs"><option value="">Choose a plan…</option>{plans.data?.items.filter((plan) => plan.id !== data.planId).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
                  <Button size="sm" variant="outline" disabled={!targetPlan || change.isPending} onClick={() => change.mutate()}>Change plan</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Billing occurrences</CardTitle></CardHeader>
              <CardContent>
                {(occurrences.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No billing occurrences yet.</p> : (
                  <div className="divide-y divide-border/70">
                    {occurrences.data?.items.slice(0, 12).map((occurrence) => (
                      <div key={occurrence.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                        <span>#{occurrence.occurrenceNumber} · {formatDateTime(occurrence.createdAt)}</span>
                        <span>{formatMoney(occurrence.amountMinor, "INR")} · {occurrence.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Lifecycle history</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(events.data?.items ?? []).map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-3 text-xs"><span className="font-mono">{event.event}</span><span className="text-muted-foreground">{formatDateTime(event.createdAt)} · {event.actor}</span></div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-semibold text-navy">{value}</p></div>;
}
