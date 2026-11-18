"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { AffordabilityView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function AffordabilityPage() {
  const scenarios = useQuery({ queryKey: ["credit", "affordability"], queryFn: () => apiFetch<{ items: AffordabilityView[] }>("/api/credit/affordability/scenarios") });
  const [form, setForm] = useState({ amountMinor: "10000000", tenureMonths: "24", interestRateBps: "1200" });
  const create = useMutation({
    mutationFn: () => apiFetch<AffordabilityView>("/api/credit/affordability/scenarios", {
      method: "POST",
      body: JSON.stringify({ amountMinor: Number(form.amountMinor), tenureMonths: Number(form.tenureMonths), interestRateBps: Number(form.interestRateBps) }),
    }),
    onSuccess: () => void scenarios.refetch(),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Affordability planner</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Plan a repayment</h1>
      </div>
      <Alert><AlertDescription>Informational cash-flow scenario based on your recorded finances. Not a lending decision, approval or guarantee of affordability.</AlertDescription></Alert>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-5">
          <div><Label htmlFor="amount">Amount (paise)</Label><Input id="amount" type="number" value={form.amountMinor} onChange={(e) => setForm({ ...form, amountMinor: e.target.value })} className="mt-1.5 w-44" /></div>
          <div><Label htmlFor="tenure">Tenure (months)</Label><Input id="tenure" type="number" value={form.tenureMonths} onChange={(e) => setForm({ ...form, tenureMonths: e.target.value })} className="mt-1.5 w-32" /></div>
          <div><Label htmlFor="rate">Rate (bps)</Label><Input id="rate" type="number" value={form.interestRateBps} onChange={(e) => setForm({ ...form, interestRateBps: e.target.value })} className="mt-1.5 w-32" /></div>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>Calculate scenario</Button>
        </CardContent>
      </Card>
      {(scenarios.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No scenarios yet.</CardContent></Card> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {scenarios.data?.items.map((item) => (
            <Card key={item.id}>
              <CardHeader><CardTitle className="text-base">{formatMoney(item.amountMinor, item.currency)} over {item.tenureMonths} months</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Estimated EMI: {formatMoney(item.emiMinor, item.currency)}</p>
                <p>Recorded inflow / outflow: {formatMoney(item.currentInflowMinor, item.currency)} / {formatMoney(item.currentOutflowMinor, item.currency)}</p>
                <p>Existing commitments: {formatMoney(item.commitmentsMinor, item.currency)}</p>
                <p>Estimated remaining monthly cash flow: {formatMoney(item.remainingMinor, item.currency)}</p>
                <p className="text-xs text-muted-foreground">Data coverage: {(item.dataCoverageBps / 100).toFixed(0)}%</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
