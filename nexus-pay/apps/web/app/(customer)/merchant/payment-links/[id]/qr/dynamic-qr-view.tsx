"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import type { PaymentLinkView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";

/** Dynamic QR: encodes a specific payment link so the amount is fixed server-side. */
export function DynamicQrView({ id }: { id: string }) {
  const link = useQuery({
    queryKey: ["merchant", "link", id],
    queryFn: () => apiFetch<PaymentLinkView>(`/api/merchant/payment-links/${encodeURIComponent(id)}`),
    retry: false,
  });
  const data = link.data;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">QR payments</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Dynamic merchant QR</h1>
      </div>
      {link.isError ? (
        <Alert variant="destructive"><AlertDescription>{link.error instanceof ApiClientError ? link.error.message : "Payment link not found."}</AlertDescription></Alert>
      ) : null}
      {data ? (
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-base">{data.title}</CardTitle>
            <CardDescription>The customer cannot change this amount after scanning.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center font-display text-3xl font-semibold text-navy">{formatMoney(data.amountMinor, data.currency)}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/merchant/qr/link/${encodeURIComponent(data.token)}`}
              alt={`Nexus Pay dynamic QR for ${data.title}`}
              className="mx-auto w-full max-w-xs rounded-xl border border-border"
            />
            <p className="text-center text-xs text-muted-foreground">Nexus Pay QR only — not a UPI QR. Only the Nexus Pay app can pay this code.</p>
            <Button asChild variant="outline" className="w-full"><Link href="/merchant/payment-links">Back to payment links</Link></Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
