"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { MerchantPaymentView, RefundView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useState } from "react";
import { toast } from "sonner";

export default function RefundsPage() {
  const queryClient = useQueryClient();
  const refunds = useQuery({ queryKey: ["merchant", "refunds"], queryFn: () => apiFetch<{ items: RefundView[] }>("/api/merchant/refunds") });
  const payments = useQuery({ queryKey: ["merchant", "payments"], queryFn: () => apiFetch<{ items: MerchantPaymentView[] }>("/api/merchant/payments") });
  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiFetch("/api/merchant/refunds", {
      method: "POST",
      body: JSON.stringify({ paymentId, amountMinor: Math.round(Number(amount) * 100), reason, type: "PARTIAL" }),
    }),
    onSuccess: () => { setError(null); setAmount(""); setReason(""); void queryClient.invalidateQueries({ queryKey: ["merchant", "refunds"] }); toast.success("Refund request recorded"); },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not request refund."),
  });

  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">After-sale</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Refunds</h1></div>
      <Alert><AlertDescription>Raftline has no verified refund/reversal operation. Requests are recorded and reviewed; no money is moved automatically.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Request a refund</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="refund-payment">Payment</Label><select id="refund-payment" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Choose…</option>{payments.data?.items.filter((p) => p.status === "SETTLED").map((p) => <option key={p.id} value={p.id}>{p.paymentRef} · {formatMoney(p.amountMinor, p.currency)}</option>)}</select></div>
            <div><Label htmlFor="refund-amount">Amount (INR)</Label><Input id="refund-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1.5" /></div>
          </div>
          <div><Label htmlFor="refund-reason">Reason</Label><Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5" /></div>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <Button disabled={!paymentId || !amount || reason.length < 5 || create.isPending} onClick={() => create.mutate()}>Submit request</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Refund history</CardTitle></CardHeader>
        <CardContent>
          {(refunds.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No refund requests.</p> : (
            <div className="divide-y divide-border/70">
              {refunds.data?.items.map((refund) => (
                <div key={refund.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="truncate">{formatMoney(refund.amountMinor, "INR")} · {refund.reason}</span>
                  <span className="text-xs font-medium">{refund.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

