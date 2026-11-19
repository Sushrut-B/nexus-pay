"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InsuranceComparisonView, InsuranceProductView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function ComparePage() {
  const products = useQuery({ queryKey: ["insurance", "products"], queryFn: () => apiFetch<{ items: InsuranceProductView[] }>("/api/insurance/products") });
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<InsuranceComparisonView | null>(null);
  const compare = useMutation({
    mutationFn: () => apiFetch<InsuranceComparisonView>("/api/insurance/products/compare", { method: "POST", body: JSON.stringify({ productIds: selected }) }),
    onSuccess: setResult,
  });
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-4));
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Comparison</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Compare products</h1>
      </div>
      <Alert><AlertDescription>Only products in the same category can be compared. Missing values are shown as unavailable; no ranking score is applied.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Select 2–4 products</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(products.data?.items ?? []).map((product) => (
            <label key={product.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
              <input type="checkbox" checked={selected.includes(product.id)} onChange={() => toggle(product.id)} />
              <span className="flex-1">{product.name}</span>
              <span className="text-muted-foreground">{product.category}</span>
            </label>
          ))}
          <Button disabled={selected.length < 2 || compare.isPending} onClick={() => compare.mutate()}>Compare</Button>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{result.category} comparison</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {result.products.map((product) => (
              <div key={product.id} className="rounded-lg border border-border p-3">
                <p className="font-medium">{product.name} · {product.providerName}</p>
                <p>Coverage: {product.coverageMinor === null ? "Unavailable" : formatMoney(product.coverageMinor, "INR")} · Premium: {product.premiumMinor === null ? "Unavailable" : formatMoney(product.premiumMinor, "INR")}</p>
                <p className="text-xs text-amber-800">Exclusions: {product.exclusions.join("; ") || "Unavailable"}</p>
              </div>
            ))}
            {result.missingFields.length > 0 ? <p className="text-xs text-muted-foreground">Missing: {result.missingFields.join(", ")}</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
