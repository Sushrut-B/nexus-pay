"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InsuranceProductView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export function ProductDetail({ id }: { id: string }) {
  const product = useQuery({ queryKey: ["insurance", "product", id], queryFn: () => apiFetch<InsuranceProductView>(`/api/insurance/products/${encodeURIComponent(id)}`) });
  const data = product.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Product details</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.name ?? "Insurance product"}</h1>
      </div>
      {data ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{data.providerName} · {data.category.replaceAll("_", " ")}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{data.summary}</p>
            {data.coverageSummary ? <p><strong>Coverage:</strong> {data.coverageSummary}</p> : null}
            <p><strong>Sum insured:</strong> {data.coverageMinor === null ? "Unavailable" : formatMoney(data.coverageMinor, "INR")}</p>
            <p><strong>Premium:</strong> {data.premiumMinor === null ? "Unavailable" : formatMoney(data.premiumMinor, "INR")} · {data.premiumFrequency}</p>
            <p><strong>Benefits:</strong> {data.benefits.join("; ") || "Unavailable"}</p>
            <p className="text-amber-800"><strong>Exclusions:</strong> {data.exclusions.join("; ") || "Unavailable"}</p>
            <p><strong>Waiting periods:</strong> {data.waitingPeriods.join("; ") || "None provided"}</p>
            <p><strong>Eligibility:</strong> {data.eligibility.join("; ") || "Unavailable"}</p>
            <p><strong>Deductibles:</strong> {data.deductibles.join("; ") || "Unavailable"}</p>
            <p><strong>Add-ons:</strong> {data.addons.join("; ") || "Unavailable"}</p>
            <p><strong>Claim process:</strong> {data.claimProcess ?? "Unavailable"}</p>
            <p><strong>Renewal:</strong> {data.renewalTerms ?? "Unavailable"}</p>
            <p className="text-xs text-muted-foreground">Provider data retrieved {data.sourceUpdatedAt}</p>
            {data.documents.map((doc) => <a key={doc.name} href={doc.url} className="block text-xs text-primary underline" target="_blank" rel="noreferrer">{doc.name}</a>)}
            {data.isSandbox ? <Alert><AlertDescription>Sandbox fixture only. No real insurance coverage is provided.</AlertDescription></Alert> : null}
            <Button asChild size="sm"><Link href="/insurance/quotes">Request a quote</Link></Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
