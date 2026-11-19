"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { InsuranceProductView, InsuranceQuoteView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function QuotesPage() {
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: ["insurance", "products"], queryFn: () => apiFetch<{ items: InsuranceProductView[] }>("/api/insurance/products") });
  const quotes = useQuery({ queryKey: ["insurance", "quotes"], queryFn: () => apiFetch<{ items: InsuranceQuoteView[] }>("/api/insurance/quotes") });
  const [productId, setProductId] = useState("");
  const [age, setAge] = useState("30");
  const create = useMutation({
    mutationFn: () => apiFetch("/api/insurance/quotes", {
      method: "POST",
      body: JSON.stringify({ productId, answers: { age: Number(age) }, consentVersion: "sandbox-v1", termsAccepted: true }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["insurance", "quotes"] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Quotes</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Insurance quotes</h1>
      </div>
      <Alert><AlertDescription>A quote is a provider-generated price, not coverage. Your inputs are shared only after explicit consent.</AlertDescription></Alert>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-5">
          <div><Label htmlFor="product">Product</Label><select id="product" value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1.5 h-10 w-64 rounded-lg border border-input bg-background px-3 text-sm"><option value="">Choose…</option>{products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><Label htmlFor="age">Age</Label><Input id="age" type="number" value={age} onChange={(e) => setAge(e.target.value)} className="mt-1.5 w-24" /></div>
          <Button disabled={!productId || create.isPending} onClick={() => create.mutate()}>Request quote</Button>
        </CardContent>
      </Card>
      {(quotes.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No quotes yet.</CardContent></Card> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {quotes.data?.items.map((quote) => (
            <Card key={quote.id}>
              <CardHeader><CardTitle className="text-base">{quote.providerName}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Status: {quote.status}</p>
                <p>Premium: {quote.premiumMinor === null ? "Unavailable" : formatMoney(quote.premiumMinor, "INR")}</p>
                <p className="text-xs text-muted-foreground">{quote.notice}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
