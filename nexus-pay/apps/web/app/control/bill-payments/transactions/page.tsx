"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface Row { id: string; reference: string; status: string; totalMinor?: number; amountMinor?: number; paymentRef: string | null; providerRef: string | null; biller?: { name: string } }

export default function BillTransactionsPage() {
  const query = useQuery({
    queryKey: ["control", "billing", "transactions"],
    queryFn: () => apiFetch<{ payments: Row[]; recharges: Row[] }>("/api/control/bill-payments/transactions"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Bill payments" title="Transactions" description="Searchable settlement and provider references for bill payments and recharges." />
      {query.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Bill payments</CardTitle></CardHeader>
        <CardContent>
          {(query.data?.payments ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No payments.</p> : (
            <div className="divide-y divide-slate-100">
              {query.data?.payments.map((row) => (
                <div key={row.id} className="flex justify-between gap-4 py-2 text-xs">
                  <span>{row.biller?.name ?? row.reference} · {row.status}</span>
                  <span className="text-slate-500">wallet {row.paymentRef ?? "—"} / provider {row.providerRef ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
