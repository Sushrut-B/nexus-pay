"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { CreditProductView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export function ProductDetailView({ id }: { id: string }) {
  const product = useQuery({ queryKey: ["credit", "product", id], queryFn: () => apiFetch<CreditProductView>(`/api/credit/products/${encodeURIComponent(id)}`) });
  const data = product.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Product details</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.name ?? "Credit product"}</h1>
      </div>
      {data ? (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Terms & disclosure</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Lender/provider: {data.providerName}</p>
              <p>Interest: {(data.interestRateBps / 100).toFixed(2)}% p.a. ({data.interestRateType.replaceAll("_", " ")})</p>
              {data.aprBps !== null ? <p>APR: {(data.aprBps / 100).toFixed(2)}%</p> : null}
              <p>Amount: {formatMoney(data.minAmountMinor, "INR")} – {formatMoney(data.maxAmountMinor, "INR")}</p>
              <p>Tenure: {data.minTenureMonths}–{data.maxTenureMonths} months · frequency {data.repaymentFrequency}</p>
              <p>Processing fee: {formatMoney(data.processingFeeMinor, "INR")} / {(data.processingFeeBps / 100).toFixed(2)}%</p>
              <p>Other charges: {formatMoney(data.otherChargesMinor, "INR")}</p>
              <p>Prepayment: {data.prepaymentTerms ?? "Not specified"}</p>
              <p>Late payment: {data.latePaymentTerms ?? "Not specified"}</p>
              <p>Required documents: {data.requiredDocuments.join(", ") || "None specified"}</p>
              <p className="text-xs text-muted-foreground">{data.terms}</p>
              {data.isSandbox ? <Alert><AlertDescription>Sandbox development fixture. No real credit offer, approval or lender exists.</AlertDescription></Alert> : null}
              <div className="flex gap-2 pt-2">
                <Button asChild size="sm"><Link href={`/credit/eligibility?product=${encodeURIComponent(data.id)}`}>Check eligibility</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href="/credit/compare">Compare offers</Link></Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
