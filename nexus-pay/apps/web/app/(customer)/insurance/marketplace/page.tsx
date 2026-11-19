"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InsuranceProductView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

const CATEGORIES = ["ALL", "HEALTH", "LIFE", "TERM_LIFE", "MOTOR", "TWO_WHEELER", "CAR", "TRAVEL", "PERSONAL_ACCIDENT", "HOME", "OTHER"];

export default function MarketplacePage() {
  const category = "ALL";
  const products = useQuery({
    queryKey: ["insurance", "products", category],
    queryFn: () => apiFetch<{ items: InsuranceProductView[] }>(`/api/insurance/products${category === "ALL" ? "" : `?category=${category}`}`),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Marketplace</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Insurance products</h1>
      </div>
      <Alert><AlertDescription>Only provider-backed products are shown. Sandbox fixtures are labelled and provide no coverage.</AlertDescription></Alert>
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((item) => <span key={item} className={`rounded-md border px-2 py-1 text-[10px] ${item === category ? "border-primary bg-accent text-primary" : "border-border"}`}>{item.replaceAll("_", " ")}</span>)}
      </div>
      {(products.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No products are currently available.</CardContent></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.data?.items.map((product) => (
            <Card key={product.id}>
              <CardHeader><CardTitle className="text-base">{product.name}</CardTitle><p className="text-xs text-muted-foreground">{product.providerName} · {product.category.replaceAll("_", " ")}</p></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-3">{product.summary}</p>
                <p className="text-sm font-semibold">{product.coverageMinor === null ? "Coverage unavailable" : formatMoney(product.coverageMinor, "INR")}</p>
                <p className="text-xs text-muted-foreground">Premium {product.premiumMinor === null ? "unavailable" : formatMoney(product.premiumMinor, "INR")} · {product.premiumFrequency}</p>
                {product.exclusions.length > 0 ? <p className="text-[11px] text-amber-700">Key exclusions: {product.exclusions.slice(0, 2).join("; ")}</p> : null}
                {product.isSandbox ? <p className="text-[11px] text-amber-700">Sandbox fixture — not real coverage.</p> : null}
                <Button asChild size="sm" variant="outline"><Link href={`/insurance/marketplace/${encodeURIComponent(product.id)}`}>Details</Link></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

