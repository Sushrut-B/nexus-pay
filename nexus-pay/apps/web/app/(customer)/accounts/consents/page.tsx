"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { ConsentView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function ConsentsPage() {
  const queryClient = useQueryClient();
  const consents = useQuery({ queryKey: ["accounts", "consents"], queryFn: () => apiFetch<{ items: ConsentView[] }>("/api/accounts/consents") });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["accounts"] });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/accounts/consents/${encodeURIComponent(id)}/revoke`, { method: "POST", body: JSON.stringify({ reason: "User requested revocation" }) }),
    onSuccess: () => { invalidate(); toast.success("Consent revoked — future retrieval stopped"); },
    onError: () => toast.error("Could not revoke consent"),
  });
  const renew = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/accounts/consents/${encodeURIComponent(id)}/renew`, { method: "POST", body: "{}" }),
    onSuccess: () => { invalidate(); toast.success("Consent renewed"); },
    onError: () => toast.error("Could not renew consent"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Permissions</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Data-sharing consents</h1>
      </div>
      {(consents.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No consents recorded.</CardContent></Card> : (
        <div className="grid gap-4">
          {consents.data?.items.map((consent) => (
            <Card key={consent.id}>
              <CardHeader>
                <CardTitle className="text-base">{consent.providerName}</CardTitle>
                <p className="text-xs text-muted-foreground">{consent.status} · expires {formatDateTime(consent.expiresAt)}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>Purpose: {consent.purpose}</p>
                <p>Data: {consent.dataCategories.join(", ")}</p>
                <p>Period: {formatDateTime(consent.periodFrom)} → {formatDateTime(consent.periodTo)}</p>
                <div className="flex gap-2 pt-2">
                  {["ACTIVE", "EXPIRED"].includes(consent.status) ? <Button size="sm" variant="outline" disabled={renew.isPending} onClick={() => renew.mutate(consent.id)}>Renew</Button> : null}
                  {consent.status !== "REVOKED" ? <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(consent.id)}>Revoke</Button> : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
