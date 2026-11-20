"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { BillerView, SavedBillAccountView, BillPaymentView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

type FetchResult = {
  id: string; status: string; error: string | null;
  snapshots: Array<{
    id: string; billNumber: string | null; dueDate: string | null; amountMinor: number;
    minAmountMinor: number | null; status: string; expiresAt: string | null;
  }>;
};

export default function FetchBillPage() {
  const billers = useQuery({ queryKey: ["billing", "billers"], queryFn: () => apiFetch<{ items: BillerView[] }>("/api/bill-payments/billers") });
  const accounts = useQuery({ queryKey: ["billing", "accounts"], queryFn: () => apiFetch<{ items: SavedBillAccountView[] }>("/api/bill-payments/accounts") });
  const [billerId, setBillerId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [manual, setManual] = useState("");
  const [result, setResult] = useState<FetchResult | null>(null);
  const [payment, setPayment] = useState<BillPaymentView | null>(null);

  const fetchBill = useMutation({
    mutationFn: () => apiFetch<FetchResult>("/api/bill-payments/fetch", {
      method: "POST",
      body: JSON.stringify({
        billerId,
        ...(accountId ? { accountId } : {}),
        parameters: accountId ? {} : { consumerNumber: manual },
      }),
    }),
    onSuccess: (data) => { setResult(data); setPayment(null); },
    onError: () => toast.error("Bill fetch failed"),
  });
  const createPayment = useMutation({
    mutationFn: () => apiFetch<BillPaymentView>("/api/bill-payments", {
      method: "POST",
      body: JSON.stringify({
        snapshotId: result!.snapshots[0]!.id,
        ...(accountId ? { accountId } : {}),
        amountMinor: result!.snapshots[0]!.amountMinor,
        idempotencyKey: `billpay-${result!.snapshots[0]!.id}`,
        termsAccepted: true,
      }),
    }),
    onSuccess: setPayment,
    onError: () => toast.error("Could not create the payment"),
  });
  const confirm = useMutation({
    mutationFn: () => apiFetch<BillPaymentView>(`/api/bill-payments/${payment!.id}/confirm`, { method: "POST", body: "{}" }),
    onSuccess: setPayment,
    onError: () => toast.error("Payment could not be completed"),
  });

  const snapshot = result?.snapshots[0];
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Bill fetch</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Fetch and pay a bill</h1>
      </div>
      <Alert><AlertDescription>Bill data comes from the connected provider. Sandbox fixtures are not real bills. A wallet debit alone never means the bill is paid.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">1. Find your bill</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="biller">Biller</Label>
            <select id="biller" value={billerId} onChange={(e) => setBillerId(e.target.value)} className="mt-1.5 h-10 w-56 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Choose…</option>
              {billers.data?.items.filter((b) => b.canFetchBill).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="account">Saved account (optional)</Label>
            <select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1.5 h-10 w-56 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Enter manually</option>
              {accounts.data?.items.map((a) => <option key={a.id} value={a.id}>{a.nickname} · {a.maskedIdentifier}</option>)}
            </select>
          </div>
          {!accountId ? <div><Label htmlFor="identifier">Consumer number</Label><Input id="identifier" value={manual} onChange={(e) => setManual(e.target.value)} className="mt-1.5 w-48" /></div> : null}
          <Button disabled={!billerId || (!accountId && manual.length < 3) || fetchBill.isPending} onClick={() => fetchBill.mutate()}>Fetch bill</Button>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader><CardTitle className="text-base">2. Review bill</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Status: {result.status}{result.error ? ` — ${result.error}` : ""}</p>
            {snapshot ? (
              <>
                <p>Bill number: {snapshot.billNumber ?? "Unavailable"}</p>
                <p>Amount: {formatMoney(snapshot.amountMinor, "INR")}</p>
                <p>Due: {snapshot.dueDate ? new Date(snapshot.dueDate).toLocaleDateString("en-IN") : "Unavailable"}</p>
                <p className="text-xs text-muted-foreground">Valid until {snapshot.expiresAt ? new Date(snapshot.expiresAt).toLocaleString("en-IN") : "unknown"} — stale bills cannot be paid.</p>
                {!payment ? <Button disabled={createPayment.isPending} onClick={() => createPayment.mutate()}>Review payment</Button> : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {payment ? (
        <Card>
          <CardHeader><CardTitle className="text-base">3. Confirm payment</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{payment.notice}</p>
            <p>Amount: {formatMoney(payment.totalMinor, "INR")}</p>
            <p>Provider status: {payment.providerRef ?? "Not yet submitted"}</p>
            <Button disabled={confirm.isPending || payment.status === "BILLER_CONFIRMED"} onClick={() => confirm.mutate()}>Confirm and pay from wallet</Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
