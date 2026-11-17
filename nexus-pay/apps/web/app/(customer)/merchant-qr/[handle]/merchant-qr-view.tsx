"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import { formatMoney, initials } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";

interface MerchantInfo {
  handle: string;
  displayName: string;
  logoUrl: string | null;
  status: string;
  walletActive: boolean;
  disclosure: string;
}

export function MerchantQrView({ handle }: { handle: string }) {
  const merchant = useQuery({
    queryKey: ["merchant-qr", handle],
    queryFn: () => apiFetch<MerchantInfo>(`/api/merchant-qr/${encodeURIComponent(handle)}`),
  });
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState<{ paymentRef: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function pay() {
    setPending(true);
    setError(null);
    try {
      const result = await apiFetch<{ payment: { paymentRef: string } }>(`/api/merchant-qr/${encodeURIComponent(handle)}/pay`, {
        method: "POST",
        body: JSON.stringify({ clientRequestId: crypto.randomUUID(), amountMinor: Math.round(Number(amount) * 100) }),
      });
      setPayment(result.payment);
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "Could not complete payment.");
    } finally {
      setPending(false);
    }
  }

  const data = merchant.data;
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Nexus Pay QR</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-navy">Pay a merchant</h1>
      </div>
      {merchant.isError ? <Alert variant="destructive"><AlertDescription>Merchant could not be resolved.</AlertDescription></Alert> : null}
      {data ? (
        <Card>
          <CardHeader className="items-center text-center">
            <span className="grid h-14 w-14 place-items-center rounded-xl bg-navy text-lg font-semibold text-white">{initials(data.displayName)}</span>
            <CardTitle className="pt-2 text-lg">{data.displayName}</CardTitle>
            <CardDescription>@{data.handle} · {data.status}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="qr-amount">Amount (INR)</Label>
              <Input id="qr-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5" />
            </div>
            <p className="text-[11px] text-muted-foreground">Nexus Pay QR only. Not a UPI QR; no external wallet can pay it.</p>
            {payment ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-800">Payment confirmed</p>
                <p className="mt-1 font-mono text-xs">{payment.paymentRef}</p>
                <Button asChild size="sm" className="mt-3"><Link href={`/transactions/${encodeURIComponent(payment.paymentRef)}`}>View receipt</Link></Button>
              </div>
            ) : (
              <>
                {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
                <Button className="w-full" disabled={pending || !amount || !data.walletActive} onClick={() => void pay()}>
                  {pending ? "Confirming…" : `Pay ${amount ? formatMoney(Math.round(Number(amount) * 100), "INR") : ""}`}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

