"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InsuranceApplicationView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function InsuranceApplicationsPage() {
  const applications = useQuery({ queryKey: ["insurance", "applications"], queryFn: () => apiFetch<{ items: InsuranceApplicationView[] }>("/api/insurance/applications") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Applications</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Insurance applications</h1>
      </div>
      <Alert><AlertDescription>Submission is not approval and approval is not coverage. Only provider confirmation can issue a policy.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Your applications</CardTitle></CardHeader>
        <CardContent>
          {(applications.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No applications yet.</p> : (
            <div className="divide-y divide-border/70">
              {applications.data?.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{item.providerName} · {item.status}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
