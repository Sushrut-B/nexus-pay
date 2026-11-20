"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { TaxDashboardView, TaxDeadlineView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function TaxHomePage() {
  const dashboard = useQuery({ queryKey: ["tax", "dashboard"], queryFn: () => apiFetch<TaxDashboardView>("/api/tax/dashboard") });
  const deadlines = useQuery({ queryKey: ["tax", "deadlines"], queryFn: () => apiFetch<{ items: TaxDeadlineView[] }>("/api/tax/deadlines") });
  const data = dashboard.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Tax Centre</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">Understand your tax position</h1>
      </div>
      <Alert><AlertDescription>{data?.notice ?? "Nexus Pay is not a tax practitioner or filing platform. All figures are estimates from your own records, not assessed tax."}</AlertDescription></Alert>
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Financial year" value={`FY ${data.financialYear}`} />
            <Metric label="Assessment year" value={`AY ${data.assessmentYear}`} />
            <Metric label="Estimated income" value={formatMoney(data.estimatedIncomeMinor, data.currency)} />
            <Metric label="Estimated tax" value={formatMoney(data.estimatedTaxMinor, data.currency)} />
            <Metric label="Taxable income" value={formatMoney(data.taxableMinor, data.currency)} />
            <Metric label="Verified tax paid" value={formatMoney(data.verifiedTaxPaidMinor, data.currency)} />
            <Metric label="Remaining (est.)" value={formatMoney(data.remainingMinor, data.currency)} />
            <Metric label="Document completion" value={`${(data.documentCompletionBps / 100).toFixed(0)}%`} />
          </div>
          <p className="text-xs text-muted-foreground">Status: {data.status} · Rule set {data.ruleSetVersion}</p>
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Prepare</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline"><Link href="/tax/income">Review income</Link></Button>
            <Button asChild variant="outline"><Link href="/tax/compare">Compare regimes</Link></Button>
            <Button asChild variant="outline"><Link href="/tax/documents">Tax documents</Link></Button>
            <Button asChild variant="outline"><Link href="/tax/filing">Filing readiness</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Upcoming deadlines (indicative)</CardTitle></CardHeader>
          <CardContent>
            {(deadlines.data?.items ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No deadlines configured.</p> : (
              <div className="divide-y divide-border/70">
                {deadlines.data?.items.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex justify-between py-2 text-xs"><span>{item.title}</span><span className="text-muted-foreground">{new Date(item.dueDate).toLocaleDateString("en-IN")}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
