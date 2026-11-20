"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { FraudOperationsView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

export default function ControlFraudPage() {
  const overview = useQuery({ queryKey: ["control", "fraud"], queryFn: () => apiFetch<FraudOperationsView>("/api/control/fraud/overview") });
  const data = overview.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Fraud intelligence" description="Measured signals and investigation workflow. Risk scores are indicators, not proven fraud." />
      {overview.isLoading ? <LoadingState /> : null}
      {data ? (
        <>
          <Alert className="mb-4"><AlertDescription>{data.notice}</AlertDescription></Alert>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Events (24h)" value={String(data.events24h)} />
            <Metric label="Evaluations (24h)" value={String(data.evaluations24h)} />
            <Metric label="High-risk alerts" value={String(data.highRiskAlerts)} />
            <Metric label="Open cases" value={String(data.openCases)} />
            <Metric label="Auth failures (24h)" value={String(data.authFailures24h)} />
            <Metric label="Unknown payments (24h)" value={String(data.suspiciousPayments24h)} />
            <Metric label="Rules enabled" value={String(data.rulesEnabled)} />
            <Metric label="Event backlog" value={String(data.eventBacklog)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Risk classification breakdown</CardTitle></CardHeader>
              <CardContent>
                {Object.entries(data.riskByClassification).length === 0 ? <p className="py-6 text-center text-xs text-slate-500">No evaluations yet.</p> : (
                  <div className="space-y-2 text-xs">
                    {Object.entries(data.riskByClassification).map(([key, value]) => <div key={key} className="flex justify-between"><span>{key}</span><span>{value}</span></div>)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Frequently triggered rules</CardTitle></CardHeader>
              <CardContent>
                {data.ruleTriggers.length === 0 ? <p className="py-6 text-center text-xs text-slate-500">No triggered rules yet.</p> : (
                  <div className="space-y-2 text-xs">
                    {data.ruleTriggers.map((rule) => <div key={rule.code} className="flex justify-between"><span>{rule.code}</span><span>{rule.count}</span></div>)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}


