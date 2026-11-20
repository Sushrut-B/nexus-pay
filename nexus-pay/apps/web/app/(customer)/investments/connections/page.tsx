"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { InvestmentConnectionView, InvestmentProviderView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function ConnectionsPage() {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["investments", "providers"], queryFn: () => apiFetch<{ items: InvestmentProviderView[] }>("/api/investments/providers") });
  const connections = useQuery({ queryKey: ["investments", "connections"], queryFn: () => apiFetch<{ items: InvestmentConnectionView[] }>("/api/investments/connections") });
  const [providerCode, setProviderCode] = useState("");
  const [label, setLabel] = useState("");
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["investments", "connections"] }); void queryClient.invalidateQueries({ queryKey: ["investments", "portfolio"] }); };
  const connect = useMutation({
    mutationFn: () => apiFetch("/api/investments/connections", { method: "POST", body: JSON.stringify({ providerCode, displayName: label }) }),
    onSuccess: refresh, onError: () => toast.error("Provider is unavailable"),
  });
  const authorize = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/investments/connections/${id}/authorize`, { method: "POST", body: "{}" }),
    onSuccess: () => { refresh(); toast.success("Connected — synchronization queued"); },
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/investments/connections/${id}`, { method: "DELETE", body: "{}" }),
    onSuccess: refresh,
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Connections</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Investment account connections</h1>
      </div>
      <Alert><AlertDescription>Only read-only portfolio synchronization is supported. We never collect broker passwords, trading PINs, OTPs or depository credentials. Revoking consent stops future syncs.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Connect a provider</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="provider">Provider</Label>
            <select id="provider" value={providerCode} onChange={(e) => setProviderCode(e.target.value)} className="mt-1.5 h-10 w-56 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Choose…</option>
              {(providers.data?.items ?? []).filter((p) => p.available).map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}
            </select>
          </div>
          <div><Label htmlFor="label">Label</Label><Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1.5 w-44" /></div>
          <Button disabled={!providerCode || connect.isPending} onClick={() => connect.mutate()}>Connect</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Your connections</CardTitle></CardHeader>
        <CardContent>
          {(connections.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No connections yet.</p> : (
            <div className="divide-y divide-border/70">
              {connections.data?.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium">{item.providerCode} · {item.status}</p>
                    <p className="text-xs text-muted-foreground">Consent {item.consentStatus ?? "none"} · {item.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString("en-IN") : "never synced"}</p>
                  </div>
                  <div className="flex gap-2">
                    {item.status === "AUTHORIZATION_PENDING" ? <Button size="sm" variant="outline" onClick={() => authorize.mutate(item.id)}>Authorize</Button> : null}
                    <Button size="sm" variant="ghost" onClick={() => disconnect.mutate(item.id)}>Disconnect</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
