"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { BillerView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function BillerMarketplacePage() {
  const [category, setCategory] = useState("");
  const billers = useQuery({
    queryKey: ["billing", "billers", category],
    queryFn: () => apiFetch<{ items: BillerView[] }>(`/api/bill-payments/billers${category ? `?category=${category}` : ""}`),
  });
  const items = billers.data?.items ?? [];
  const categories = Array.from(new Set(items.map((item) => item.category)));
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Biller directory</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Browse billers</h1>
      </div>
      <div className="flex flex-wrap gap-1">
        <button className={`rounded-md border px-2 py-1 text-[10px] ${!category ? "border-primary bg-accent text-primary" : "border-border"}`} onClick={() => setCategory("")}>All</button>
        {categories.map((item) => (
          <button key={item} className={`rounded-md border px-2 py-1 text-[10px] ${category === item ? "border-primary bg-accent text-primary" : "border-border"}`} onClick={() => setCategory(item)}>
            {item.replaceAll("_", " ")}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No provider-backed billers are available. Enable an official sandbox to explore the workflow.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((biller) => (
            <Card key={biller.id}>
              <CardHeader>
                <CardTitle className="text-base">{biller.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{biller.category.replaceAll("_", " ")} · {biller.providerName}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p>{biller.billerType === "PREPAID" ? "Prepaid recharge" : "Postpaid bill"}</p>
                <p className="text-muted-foreground">Required: {biller.parameters.filter((p) => p.required).map((p) => p.label).join(", ") || "None"}</p>
                <p className="text-amber-700">Sandbox fixture — not a real biller.</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

