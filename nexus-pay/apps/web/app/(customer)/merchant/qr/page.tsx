"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import type { MerchantView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function QrPage() {
  const merchant = useQuery({ queryKey: ["merchant", "me"], queryFn: () => apiFetch<MerchantView>("/api/merchants") });
  const handle = merchant.data?.handle;
  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">QR payments</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Your merchant QR</h1></div>
      {!merchant.data || merchant.data.status !== "ACTIVE" ? (
        <Alert><AlertDescription>An active merchant account is required to show a QR code.</AlertDescription></Alert>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Static QR</CardTitle><CardDescription>Customers open this code in Nexus Pay and enter an amount.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/merchant/qr/${encodeURIComponent(handle!)}`} alt={`Nexus Pay QR for ${merchant.data.displayName}`} className="mx-auto w-full max-w-xs rounded-xl border border-border" />
              <p className="text-center text-xs text-muted-foreground">Nexus Pay QR · not a UPI QR. Only the Nexus Pay app can pay this code.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">How it works</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>1. A customer scans the QR with Nexus Pay.</p>
              <p>2. Your verified business profile is displayed.</p>
              <p>3. The customer enters an amount and confirms.</p>
              <p>4. Raftline settles the payment; both histories show the same reference.</p>
              <p className="text-xs">For an exact amount, create a payment link or order-linked QR instead.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}


