"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { LoanView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function LoansPage() {
  const loans = useQuery({ queryKey: ["credit", "loans"], queryFn: () => apiFetch<{ items: LoanView[] }>("/api/credit/loans") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Loan servicing</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">My loans</h1>
      </div>
      {(loans.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No active loans.</CardContent></Card> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {loans.data?.items.map((loan) => (
            <Card key={loan.id}>
              <CardHeader><CardTitle className="text-base">{loan.lender}</CardTitle><p className="text-xs text-muted-foreground">{loan.loanRef}</p></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Outstanding: {formatMoney(loan.outstandingPrincipalMinor, "INR")}</p>
                <p>EMI: {formatMoney(loan.emiMinor, "INR")} · next due {loan.nextDueDate ? formatDateTime(loan.nextDueDate) : "—"}</p>
                <p className="text-xs text-muted-foreground">Provider-reported at {formatDateTime(loan.providerReportedAt)}</p>
                {loan.isSandbox ? <p className="text-[11px] text-amber-700">Sandbox fixture — not a real loan.</p> : null}
                <Button asChild size="sm" variant="outline"><Link href={`/credit/loans/${encodeURIComponent(loan.id)}`}>View details</Link></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
