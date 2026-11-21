"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { PrivacyConsentView } from "@nexus/shared-types";
import { SecurityNav } from "@/components/security/security-nav";
import { toast } from "sonner";

export default function PrivacyCentrePage() {
  const queryClient = useQueryClient();
  const data = useQuery({
    queryKey: ["security", "consents"],
    queryFn: () => apiFetch<{ purposes: ReadonlyArray<{ code: string; label: string; description: string; version: string; required: boolean }>; consents: PrivacyConsentView[]; retentionNotice: string }>("/api/security/privacy/consents"),
  });
  const toggle = useMutation({
    mutationFn: (input: { purpose: string; version: string; granted: boolean }) => apiFetch("/api/security/privacy/consents", { method: "POST", body: JSON.stringify({ ...input, source: "SECURITY_CENTRE" }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["security", "consents"] }); toast.success("Preference saved"); },
  });
  const status = new Map((data.data?.consents ?? []).map((c) => [c.purpose, c.status]));
  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Security Centre</p><h1 className="mt-2 font-display text-3xl font-semibold text-navy">Privacy & consent</h1></div>
      <SecurityNav />
      <p className="text-xs text-muted-foreground">Only implemented purposes are shown. Consent to product analytics is never consent to transactions, marketing or external account access.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {(data.data?.purposes ?? []).map((purpose) => {
          const granted = status.get(purpose.code) !== "WITHDRAWN";
          return (
            <Card key={purpose.code}>
              <CardHeader><CardTitle className="text-base">{purpose.label}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{purpose.description}</p>
                <p className="text-xs text-muted-foreground">Version {purpose.version} Â· {purpose.required ? "Required for service" : "Optional"} Â· {granted ? "Granted" : "Withdrawn"}</p>
                <Button size="sm" variant={granted ? "outline" : "default"} disabled={purpose.required || toggle.isPending}
                  onClick={() => toggle.mutate({ purpose: purpose.code, version: purpose.version, granted: !granted })}>
                  {purpose.required ? "Always active" : granted ? "Withdraw" : "Grant"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card><CardHeader><CardTitle className="text-base">Retention & deletion</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{data.data?.retentionNotice ?? "Loading retention informationâ€¦"}</p></CardContent></Card>
    </div>
  );
}
