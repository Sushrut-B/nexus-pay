"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { LoanView, RepaymentView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export function LoanDetailView({ id }: { id: string }) {
  const loan = useQuery({ queryKey: ["credit", "loan", id], queryFn: () => apiFetch<LoanView>(`/api/credit/loans/${encodeURIComponent(id)}`) });
  const schedule = useQuery({ queryKey: ["credit", "schedule", id], queryFn: () => apiFetch<{ items: RepaymentView[] }>(`/api/credit/loans/${encodeURIComponent(id)}/schedule`) });
  const data = loan.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Loan details</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.lender ?? "Loan"}</h1>
      </div>
      {data ? (
        <>
          <Alert><AlertDescription>All values are provider-reported. Nexus Pay does not debit wallets for repayments and is not the lender.</AlertDescription></Alert>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Original principal" value={formatMoney(data.originalPrincipalMinor, "INR")} />
            <Metric label="Outstanding" value={formatMoney(data.outstandingPrincipalMinor, "INR")} />
            <Metric label="Total repaid" value={formatMoney(data.totalRepaidMinor, "INR")} />
            <Metric label="EMI" value={formatMoney(data.emiMinor, "INR")} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Repayment schedule</CardTitle></CardHeader>
            <CardContent>
              {(schedule.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No provider schedule available.</p> : (
                <div className="divide-y divide-border/70">
                  {schedule.data?.items.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                      <span>#{row.installmentNo} · {formatDateTime(row.dueDate)}</span>
                      <span>{formatMoney(row.totalMinor, "INR")} · {row.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-semibold text-navy">{value}</p></div>;
}
