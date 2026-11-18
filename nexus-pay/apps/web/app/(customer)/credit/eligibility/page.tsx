"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { CreditProductView, EligibilityResult } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function EligibilityPage() {
  const products = useQuery({ queryKey: ["credit", "products"], queryFn: () => apiFetch<{ items: CreditProductView[] }>("/api/credit/products") });
  const [form, setForm] = useState({
    productId: "",
    employmentCategory: "SALARIED",
    monthlyIncomeRange: "25000_50000",
    employmentMonths: "24",
    existingObligationsMinor: "0",
    requestedAmountMinor: "10000000",
    requestedTenureMonths: "24",
    purpose: "Personal use",
  });
  const [result, setResult] = useState<EligibilityResult | null>(null);
  const assess = useMutation({
    mutationFn: () => apiFetch<EligibilityResult>("/api/credit/eligibility", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        employmentMonths: Number(form.employmentMonths),
        existingObligationsMinor: Number(form.existingObligationsMinor),
        requestedAmountMinor: Number(form.requestedAmountMinor),
        requestedTenureMonths: Number(form.requestedTenureMonths),
      }),
    }),
    onSuccess: setResult,
  });
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Eligibility</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Pre-assessment</h1>
      </div>
      <Alert><AlertDescription>This is a pre-assessment only. It is not a credit approval, guarantee of acceptance or official credit score.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Your details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label htmlFor="product">Product</Label><select id="product" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Choose…</option>{products.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="employment">Employment category</Label><select id="employment" value={form.employmentCategory} onChange={(e) => setForm({ ...form, employmentCategory: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{["SALARIED", "SELF_EMPLOYED", "BUSINESS", "OTHER"].map((value) => <option key={value}>{value}</option>)}</select></div>
            <div><Label htmlFor="income">Monthly income range</Label><select id="income" value={form.monthlyIncomeRange} onChange={(e) => setForm({ ...form, monthlyIncomeRange: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{["BELOW_25000", "25000_50000", "50000_100000", "ABOVE_100000"].map((value) => <option key={value}>{value}</option>)}</select></div>
            <div><Label htmlFor="months">Employment months</Label><Input id="months" type="number" value={form.employmentMonths} onChange={(e) => setForm({ ...form, employmentMonths: e.target.value })} className="mt-1.5" /></div>
            <div><Label htmlFor="obligations">Existing obligations (paise)</Label><Input id="obligations" type="number" value={form.existingObligationsMinor} onChange={(e) => setForm({ ...form, existingObligationsMinor: e.target.value })} className="mt-1.5" /></div>
            <div><Label htmlFor="amount">Requested amount (paise)</Label><Input id="amount" type="number" value={form.requestedAmountMinor} onChange={(e) => setForm({ ...form, requestedAmountMinor: e.target.value })} className="mt-1.5" /></div>
            <div><Label htmlFor="tenure">Tenure (months)</Label><Input id="tenure" type="number" value={form.requestedTenureMonths} onChange={(e) => setForm({ ...form, requestedTenureMonths: e.target.value })} className="mt-1.5" /></div>
          </div>
          <div><Label htmlFor="purpose">Purpose</Label><Input id="purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className="mt-1.5" /></div>
          <Button disabled={!form.productId || assess.isPending} onClick={() => assess.mutate()}>Check eligibility</Button>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{result.outcome.replaceAll("_", " ")}</p>
            <p className="text-muted-foreground">{result.explanation}</p>
            <p className="text-xs text-muted-foreground">Declared: {result.declaredFields.join(", ")}</p>
            <p className="text-xs text-muted-foreground">Observed (read-only): {result.observedFields.join(", ")}</p>
            <Alert><AlertDescription>{result.notice}</AlertDescription></Alert>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
