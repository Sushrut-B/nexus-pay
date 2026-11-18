"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InvoiceView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function MerchantInvoicesPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const invoices = useQuery({
    queryKey: ["merchant", "invoices", status],
    queryFn: () => apiFetch<{ items: InvoiceView[] }>(`/api/merchant/invoices${status ? `?status=${status}` : ""}`),
  });
  const voidInvoice = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/merchant/invoices/${encodeURIComponent(id)}/void`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["merchant", "invoices"] }); toast.success("Invoice voided"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Could not void invoice"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Billing documents</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Invoices</h1>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Invoice status" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          <option value="">All statuses</option>
          {["DRAFT", "OPEN", "PROCESSING", "PAID", "PAST_DUE", "VOID", "UNCOLLECTIBLE"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </select>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">All invoices</CardTitle></CardHeader>
        <CardContent>
          {(invoices.data?.items ?? []).length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {invoices.data?.items.map((invoice) => (
                <div key={invoice.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-medium">{invoice.invoiceNumber}</p>
                    <p className="text-[10px] text-muted-foreground">{invoice.customerName} · {formatDateTime(invoice.issueDate)} · {invoice.status}</p>
                  </div>
                  <p className="text-sm font-semibold">{formatMoney(invoice.totalMinor, invoice.currency)}</p>
                  <Button size="sm" variant="ghost" asChild><a href={`/api/merchant/invoices/${encodeURIComponent(invoice.id)}/pdf`} download>Download</a></Button>
                  {["OPEN", "DRAFT"].includes(invoice.status) ? <Button size="sm" variant="ghost" disabled={voidInvoice.isPending} onClick={() => voidInvoice.mutate(invoice.id)}>Void</Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
