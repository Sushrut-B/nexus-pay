"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import { formatMoney, initials } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";

interface CheckoutData {
  merchant: { id: string; displayName: string; handle: string; logoUrl: string | null; brandColor: string | null; status: string };
  title: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  signedIn: boolean;
}

export function CheckoutView({ token }: { token: string }) {
  const checkout = useQuery({
    queryKey: ["checkout", token],
    queryFn: () => apiFetch<CheckoutData>(`/api/checkout/${encodeURIComponent(token)}`),
  });
  const [payment, setPayment] = useState<{ paymentRef: string; amountMinor: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    setError(null);
    const clientRequestId = crypto.randomUUID();
    try {
      const result = await apiFetch<{ payment: { paymentRef: string; amountMinor: number } }>(
        `/api/checkout/${encodeURIComponent(token)}/confirm`,
        { method: "POST", body: JSON.stringify({ clientRequestId }) },
      );
      setPayment(result.payment);
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "Could not confirm payment.");
    } finally {
      setPending(false);
    }
  }

  const data = checkout.data;
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Nexus Pay checkout</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-navy">Secure sandbox payment</h1>
      </div>

      {checkout.isError ? (
        <Alert variant="destructive"><AlertDescription>{checkout.error instanceof ApiClientError ? checkout.error.message : "Checkout could not be loaded."}</AlertDescription></Alert>
      ) : null}
      {!data ? null : (
        <Card>
          <CardHeader className="items-center text-center">
            {data.merchant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.merchant.logoUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-xl bg-navy text-lg font-semibold text-white">{initials(data.merchant.displayName)}</span>
            )}
            <CardTitle className="pt-2 text-lg">{data.merchant.displayName}</CardTitle>
            <CardDescription>@{data.merchant.handle} · {data.merchant.status}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl border border-border bg-secondary/30 px-5 py-6 text-center">
              <p className="text-xs text-muted-foreground">{data.title}</p>
              {data.description ? <p className="mt-1 text-xs text-muted-foreground">{data.description}</p> : null}
              <p className="mt-3 font-display text-4xl font-semibold tracking-[-0.04em] text-navy">{formatMoney(data.amountMinor, data.currency)}</p>
            </div>
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              Sandbox payment. No UPI, card, bank or real-world money is involved.
            </div>
            {payment ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
                <p className="text-sm font-semibold text-emerald-800">Payment confirmed</p>
                <p className="mt-1 font-mono text-xs text-emerald-900">{payment.paymentRef}</p>
                <Button asChild className="mt-3" size="sm"><Link href={`/transactions/${encodeURIComponent(payment.paymentRef)}`}>View receipt</Link></Button>
              </div>
            ) : (
              <>
                {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
                {data.signedIn ? (
                  <Button className="w-full" onClick={() => void confirm()} disabled={pending}>
                    {pending ? "Confirming…" : `Confirm and pay ${formatMoney(data.amountMinor, data.currency)}`}
                  </Button>
                ) : (
                  <Button asChild className="w-full">
                    <Link href={`/login?next=${encodeURIComponent(`/pay-link/${token}`)}`}>Sign in to pay</Link>
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

