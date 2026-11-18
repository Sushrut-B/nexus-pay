"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { PlanView } from "@nexus/shared-types";
import { BILLING_FREQUENCIES } from "@nexus/shared-types";
import { formatMoney, formatDateTime } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function PlansPage() {
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: ["merchant", "plans"], queryFn: () => apiFetch<{ items: PlanView[] }>("/api/merchant/plans") });
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", amount: "", frequency: "MONTHLY", intervalCount: "1",
    trialDays: "0", setupFee: "0", introPrice: "", introPeriods: "0",
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const amountMinor = Math.round(Number(form.amount) * 100);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Enter a valid amount.");
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description || undefined,
        amountMinor,
        currency: "INR",
        frequency: form.frequency,
        intervalCount: Number(form.intervalCount) || 1,
        trialDays: Number(form.trialDays) || 0,
        setupFeeMinor: Math.round(Number(form.setupFee) * 100),
        status: "ACTIVE",
      };
      if (form.introPrice) {
        body.introPriceMinor = Math.round(Number(form.introPrice) * 100);
        body.introPeriods = Number(form.introPeriods) || 1;
      }
      return apiFetch("/api/merchant/plans", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      setShow(false);
      setForm({ name: "", description: "", amount: "", frequency: "MONTHLY", intervalCount: "1", trialDays: "0", setupFee: "0", introPrice: "", introPeriods: "0" });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["merchant", "plans"] });
      toast.success("Plan published — share its checkout page");
    },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not create plan."),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/merchant/plans/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["merchant", "plans"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Recurring revenue</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Subscription plans</h1>
        </div>
        <Button onClick={() => setShow((value) => !value)}>{show ? "Close" : "New plan"}</Button>
      </div>

      <Alert><AlertDescription>Plan prices are frozen into each subscription when a customer subscribes. Editing a plan never changes an existing subscriber&apos;s price.</AlertDescription></Alert>

      {show ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="plan-name">Plan name</Label><Input id="plan-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="plan-amount">Amount (INR / period)</Label><Input id="plan-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" className="mt-1.5" /></div>
              <div><Label htmlFor="plan-frequency">Billing frequency</Label><select id="plan-frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{BILLING_FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{frequency.toLowerCase()}</option>)}</select></div>
              <div><Label htmlFor="plan-interval">Every N periods</Label><Input id="plan-interval" type="number" min="1" value={form.intervalCount} onChange={(e) => setForm({ ...form, intervalCount: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="plan-trial">Free trial (days)</Label><Input id="plan-trial" type="number" min="0" value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="plan-setup">Setup fee (INR)</Label><Input id="plan-setup" value={form.setupFee} onChange={(e) => setForm({ ...form, setupFee: e.target.value })} inputMode="decimal" className="mt-1.5" /></div>
              <div><Label htmlFor="plan-intro">Introductory price (INR, optional)</Label><Input id="plan-intro" value={form.introPrice} onChange={(e) => setForm({ ...form, introPrice: e.target.value })} inputMode="decimal" className="mt-1.5" /></div>
              <div><Label htmlFor="plan-intro-periods">Intro periods</Label><Input id="plan-intro-periods" type="number" min="0" value={form.introPeriods} onChange={(e) => setForm({ ...form, introPeriods: e.target.value })} className="mt-1.5" /></div>
            </div>
            <div><Label htmlFor="plan-desc">Description</Label><Input id="plan-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" /></div>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button disabled={!form.name || !form.amount || create.isPending} onClick={() => create.mutate()}>Publish plan</Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">Your plans</CardTitle></CardHeader>
        <CardContent>
          {(plans.data?.items ?? []).length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">No plans yet. Create one to start selling subscriptions.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {plans.data?.items.map((plan) => (
                <div key={plan.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{plan.name}</p>
                    <p className="text-[10px] text-muted-foreground">{plan.frequency.toLowerCase()} · {formatDateTime(plan.createdAt)} · {plan.status}</p>
                  </div>
                  <p className="text-sm font-semibold">{formatMoney(plan.amountMinor, plan.currency)}</p>
                  <Button size="sm" variant="ghost" asChild><Link href={`/subscribe/${encodeURIComponent(plan.checkoutToken)}`}>Preview</Link></Button>
                  {plan.status === "ACTIVE" ? (
                    <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: plan.id, status: "ARCHIVED" })}>Archive</Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: plan.id, status: "ACTIVE" })}>Activate</Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
