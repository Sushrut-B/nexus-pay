"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import type { MerchantCustomerView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function CustomersPage() {
  const customers = useQuery({ queryKey: ["merchant", "customers"], queryFn: () => apiFetch<{ items: MerchantCustomerView[] }>("/api/merchant/customers") });
  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Relationships</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Customers</h1></div>
      <Card>
        <CardHeader><CardTitle className="text-base">Customers who paid you</CardTitle><CardDescription>Contact details are masked; no wallet balances are shown.</CardDescription></CardHeader>
        <CardContent>
          {(customers.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No customers yet.</p> : (
            <div className="divide-y divide-border/70">
              {customers.data?.items.map((customer) => (
                <div key={customer.id} className="flex flex-wrap items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{customer.displayName}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{[customer.emailMasked, customer.phoneMasked].filter(Boolean).join(" · ")}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{customer.orderCount} orders · {formatDateTime(customer.lastPurchaseAt)}</p>
                  <p className="text-sm font-semibold">{formatMoney(customer.totalPaidMinor, "INR")}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


