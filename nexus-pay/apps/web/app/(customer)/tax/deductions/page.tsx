"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { TaxDeductionView, TaxCreditView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function TaxDeductionsPage() {
  const deductions = useQuery({ queryKey: ["tax", "deductions"], queryFn: () => apiFetch<{ items: TaxDeductionView[] }>("/api/tax/deductions") });
  const credits = useQuery({ queryKey: ["tax", "credits"], queryFn: () => apiFetch<{ items: TaxCreditView[] }>("/api/tax/credits") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Deductions & credits</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Deductions, TDS & TCS</h1>
      </div>
      <Alert><AlertDescription>Deduction eligibility is regime-specific and not assumed from an entered amount. Only verified credits reduce an estimate.</AlertDescription></Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Deduction records</CardTitle></CardHeader>
          <CardContent>
            {(deductions.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No deduction records.</p> : (
              <div className="divide-y divide-border/70">
                {deductions.data?.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-3 text-sm">
                    <span>{item.label} · {item.regime} · {item.verified ? "verified" : "unverified"}</span>
                    <span className="text-muted-foreground">{formatMoney(item.amountMinor, "INR")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Tax credits</CardTitle></CardHeader>
          <CardContent>
            {(credits.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No TDS/TCS or advance tax credits.</p> : (
              <div className="divide-y divide-border/70">
                {credits.data?.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-3 text-sm">
                    <span>{item.kind} · {item.status} · {item.verified ? "verified" : "unverified"}</span>
                    <span className="text-muted-foreground">{formatMoney(item.amountMinor, "INR")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
