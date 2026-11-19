"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InsurancePolicyView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function PoliciesPage() {
  const policies = useQuery({ queryKey: ["insurance", "policies"], queryFn: () => apiFetch<{ items: InsurancePolicyView[] }>("/api/insurance/policies") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Coverage</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">My policies</h1>
      </div>
      <Alert><AlertDescription>Only provider-confirmed policies appear here. Sandbox policies provide no real coverage.</AlertDescription></Alert>
      {(policies.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No policies yet.</CardContent></Card> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {policies.data?.items.map((policy) => (
            <Card key={policy.id}>
              <CardHeader><CardTitle className="text-base">{policy.providerName}</CardTitle><p className="text-xs text-muted-foreground">{policy.policyNumberMasked} · {policy.category}</p></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Coverage: {formatMoney(policy.coverageMinor, "INR")}</p>
                <p>Status: {policy.status} · ends {formatDateTime(policy.endDate)}</p>
                <p className="text-xs text-muted-foreground">Provider reported {formatDateTime(policy.providerReportedAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
