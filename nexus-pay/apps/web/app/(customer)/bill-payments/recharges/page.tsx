"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { BillerView, RechargePlanView, RechargeView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function RechargesPage() {
  const queryClient = useQueryClient();
  const operators = useQuery({ queryKey: ["billing", "operators"], queryFn: () => apiFetch<{ items: BillerView[] }>("/api/recharges/operators") });
  const recharges = useQuery({ queryKey: ["billing", "recharges"], queryFn: () => apiFetch<{ items: RechargeView[] }>("/api/recharges") });
  const [billerId, setBillerId] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [amount, setAmount] = useState("199");
  const [planId, setPlanId] = useState("");
  const plans = useQuery({
    queryKey: ["billing", "plans", billerId],
    enabled: Boolean(billerId),
    queryFn: () => apiFetch<{ items: RechargePlanView[] }>(`/api/recharges/plans?billerId=${encodeURIComponent(billerId)}`),
  });
  const create = useMutation({
    mutationFn: () => apiFetch<RechargeView>("/api/recharges", {
      method: "POST",
      body: JSON.stringify({
        billerId, amountMinor: Number(amount) * 100, planId: planId || undefined,
        parameters: { mobileNumber: identifier },
        idempotencyKey: `recharge-${Date.now()}`, termsAccepted: true,
      }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["billing", "recharges"] }); toast.success("Recharge submitted"); },
    onError: () => toast.error("Recharge could not be created"),
  });
  const confirm = useMutation({
    mutationFn: (id: string) => apiFetch<RechargeView>(`/api/recharges/${id}/confirm`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["billing", "recharges"] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Recharges</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Prepaid recharges</h1>
      </div>
      <Alert><AlertDescription>Plans and confirmations come from the connected provider. Sandbox plans are fixtures. A wallet debit alone does not prove the recharge succeeded.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">New recharge</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="operator">Operator</Label>
            <select id="operator" value={billerId} onChange={(e) => { setBillerId(e.target.value); setPlanId(""); }} className="mt-1.5 h-10 w-56 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Choose…</option>
              {operators.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><Label htmlFor="number">Mobile number</Label><Input id="number" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="mt-1.5 w-44" /></div>
          <div><Label htmlFor="amount">Amount (₹)</Label><Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5 w-28" /></div>
          <Button disabled={!billerId || identifier.length < 6 || create.isPending} onClick={() => create.mutate()}>Continue</Button>
        </CardContent>
      </Card>
      {(plans.data?.items ?? []).length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Provider plan catalogue</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {plans.data?.items.map((plan) => (
              <button key={plan.id} className={`rounded-lg border p-3 text-left text-xs ${planId === plan.id ? "border-primary" : "border-border"}`} onClick={() => { setPlanId(plan.id); setAmount(String(plan.priceMinor / 100)); }}>
                <p className="font-medium">{plan.name}</p>
                <p className="text-muted-foreground">{formatMoney(plan.priceMinor, "INR")} · {plan.validity ?? "Validity unavailable"}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-base">Recharge history</CardTitle></CardHeader>
        <CardContent>
          {(recharges.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No recharges yet.</p> : (
            <div className="divide-y divide-border/70">
              {recharges.data?.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{item.billerName} · {formatMoney(item.amountMinor, "INR")} · {item.notice}</span>
                  {item.status === "VALIDATED" ? <Button size="sm" variant="ghost" disabled={confirm.isPending} onClick={() => confirm.mutate(item.id)}>Confirm</Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
