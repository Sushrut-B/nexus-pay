"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { BillPaymentView, BillReceiptView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function BillHistoryPage() {
  const queryClient = useQueryClient();
  const payments = useQuery({ queryKey: ["billing", "payments"], queryFn: () => apiFetch<{ items: BillPaymentView[] }>("/api/bill-payments") });
  const receipts = useQuery({ queryKey: ["billing", "receipts"], queryFn: () => apiFetch<{ items: BillReceiptView[] }>("/api/bill-payments/receipts") });
  const createReceipt = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/bill-payments/${id}/receipt`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["billing", "receipts"] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">History</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Bill payment history & receipts</h1>
      </div>
      <p className="text-xs text-muted-foreground">A Nexus Pay receipt is a payment record, not an official biller receipt. Only provider-confirmed payments count as paid.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
        <CardContent>
          {(payments.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No bill payments yet.</p> : (
            <div className="divide-y divide-border/70">
              {payments.data?.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{item.billerName} · {formatMoney(item.totalMinor, "INR")} · {item.notice}</span>
                  {item.status === "WALLET_SETTLED" || item.status === "BILLER_CONFIRMED" ? (
                    <Button size="sm" variant="ghost" disabled={createReceipt.isPending} onClick={() => createReceipt.mutate(item.id)}>Create receipt</Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Nexus Pay payment records</CardTitle></CardHeader>
        <CardContent>
          {(receipts.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No receipts yet.</p> : (
            <div className="divide-y divide-border/70">
              {receipts.data?.items.map((item) => (
                <div key={item.id} className="flex justify-between py-2 text-xs">
                  <span>{item.reference}</span>
                  <span className="text-muted-foreground">{formatMoney(item.amountMinor, "INR")} · {item.status} · Nexus Pay record</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
