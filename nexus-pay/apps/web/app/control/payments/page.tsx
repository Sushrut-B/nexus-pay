"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { PaymentOperationView } from "@nexus/shared-types";
import { PAYMENT_INTENT_STATUSES } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, EmptyState, LoadingState, StatusPill } from "@/components/control/ui";

export default function PaymentsPage() {
  const [paymentRef, setPaymentRef] = useState("");
  const [status, setStatus] = useState("");
  const payments = useQuery({
    queryKey: ["control", "payments", paymentRef, status],
    queryFn: () =>
      apiFetch<{ items: PaymentOperationView[] }>(
        `/api/control/payments?paymentRef=${encodeURIComponent(paymentRef)}&status=${encodeURIComponent(status)}`,
      ),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Financial operations" title="Payments" description="Read-only investigation of actual payment intents. Sensitive identifiers are masked." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Payment reference / intent id" aria-label="Search payments" className="h-9 w-64" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs">
          <option value="">All statuses</option>
          {PAYMENT_INTENT_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      {payments.isLoading ? <LoadingState /> : null}
      {(payments.data?.items ?? []).length === 0 && !payments.isLoading ? (
        <EmptyState title="No payment operations" message="Verified payment intents will appear here." />
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Recent operations</CardTitle></CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {payments.data?.items.map((payment) => (
              <Link key={payment.intentId} href={`/control/payments/${encodeURIComponent(payment.intentId)}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-medium text-slate-900">{payment.paymentRef ?? payment.intentId}</p>
                  <p className="text-[10px] text-slate-500">{formatDateTime(payment.createdAt)} · key {payment.idempotencyKeyMasked}</p>
                </div>
                <p className="text-xs font-semibold text-slate-900">{formatMoney(payment.amountMinor, payment.currency)}</p>
                <StatusPill state={payment.status} tone={payment.status === "SETTLED" ? "healthy" : payment.status === "REJECTED" ? "critical" : "warning"} />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
