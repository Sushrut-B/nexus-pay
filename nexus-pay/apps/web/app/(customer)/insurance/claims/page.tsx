"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InsuranceClaimView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function ClaimsPage() {
  const claims = useQuery({ queryKey: ["insurance", "claims"], queryFn: () => apiFetch<{ items: InsuranceClaimView[] }>("/api/insurance/claims") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Claims</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Claims</h1>
      </div>
      <Alert><AlertDescription>Only provider-confirmed statuses are shown. Nexus Pay does not approve or settle claims.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Your claims</CardTitle></CardHeader>
        <CardContent>
          {(claims.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No claims yet.</p> : (
            <div className="divide-y divide-border/70">
              {claims.data?.items.map((claim) => (
                <div key={claim.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{claim.claimType} · {claim.providerName} · {claim.status}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(claim.lastUpdate)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
