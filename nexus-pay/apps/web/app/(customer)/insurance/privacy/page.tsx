"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { InsuranceConsentView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";
import { useState } from "react";

export default function PrivacyPage() {
  const queryClient = useQueryClient();
  const consents = useQuery({ queryKey: ["insurance", "consents"], queryFn: () => apiFetch<{ items: InsuranceConsentView[] }>("/api/insurance/consents") });
  const [providerId, setProviderId] = useState("");
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/insurance/consents/${encodeURIComponent(id)}/revoke`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["insurance", "consents"] }); toast.success("Consent revoked — future sharing blocked"); },
    onError: () => toast.error("Could not revoke consent"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Privacy centre</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Consent & data sharing</h1>
      </div>
      <Alert><AlertDescription>No personal or medical data is shared with an insurer without explicit consent. Revocation stops future retrieval.</AlertDescription></Alert>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-5">
          <div><Label htmlFor="provider">Provider ID</Label><Input id="provider" value={providerId} onChange={(e) => setProviderId(e.target.value)} className="mt-1.5 w-64" /></div>
        </CardContent>
      </Card>
      {(consents.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No consents recorded.</CardContent></Card> : (
        <div className="grid gap-4">
          {consents.data?.items.map((consent) => (
            <Card key={consent.id}>
              <CardHeader><CardTitle className="text-base">{consent.providerName}</CardTitle><p className="text-xs text-muted-foreground">{consent.status} · {formatDateTime(consent.createdAt)}</p></CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>Purpose: {consent.purpose}</p>
                <p>Data: {consent.dataCategories.join(", ")}</p>
                <p>Shared fields: {consent.sharedFields.join(", ") || "None"}</p>
                {consent.status !== "REVOKED" ? <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(consent.id)}>Revoke</Button> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
