"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { CreditProductView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function CreditMarketplacePage() {
  const products = useQuery({ queryKey: ["credit", "products"], queryFn: () => apiFetch<{ items: CreditProductView[] }>("/api/credit/products") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Credit marketplace</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Explore credit products</h1>
      </div>
      <Alert><AlertDescription>Nexus Pay is a credit discovery and application workflow platform, not a lender. Offers shown are either provider-backed (where configured) or clearly labelled sandbox development fixtures. No approval is guaranteed.</AlertDescription></Alert>
      {(products.data?.items ?? []).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No credit products are currently available. Provider connectivity is unavailable.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {products.data?.items.map((product) => (
            <Card key={product.id}>
              <CardHeader>
                <CardTitle className="text-base">{product.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{product.providerName} · {product.type.replaceAll("_", " ")}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm font-semibold">{(product.interestRateBps / 100).toFixed(2)}% p.a. · {product.interestRateType.replaceAll("_", " ")}</p>
                <p className="text-xs text-muted-foreground">Range {formatMoney(product.minAmountMinor, "INR")} – {formatMoney(product.maxAmountMinor, "INR")} · {product.minTenureMonths}–{product.maxTenureMonths} months</p>
                {product.aprBps !== null ? <p className="text-xs text-muted-foreground">APR {(product.aprBps / 100).toFixed(2)}%</p> : null}
                {product.isSandbox ? <p className="text-[11px] text-amber-700">Sandbox development fixture — not a real offer.</p> : null}
                <Button asChild size="sm" variant="outline"><Link href={`/credit/products/${encodeURIComponent(product.id)}`}>View details</Link></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
