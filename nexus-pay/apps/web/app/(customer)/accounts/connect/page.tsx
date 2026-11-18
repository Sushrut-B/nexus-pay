"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { ConnectionInitiation, ProviderView } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";

export default function ConnectAccountPage() {
  const providers = useQuery({ queryKey: ["accounts", "providers"], queryFn: () => apiFetch<{ items: ProviderView[] }>("/api/accounts/providers") });
  const [providerCode, setProviderCode] = useState("");
  const [form, setForm] = useState({ purpose: "View balances and transactions for personal financial management", periodFrom: "2026-01-01", periodTo: "2026-12-31", durationDays: "90" });
  const [accepted, setAccepted] = useState(false);
  const [result, setResult] = useState<ConnectionInitiation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: () => apiFetch<ConnectionInitiation>("/api/accounts/connect", {
      method: "POST",
      body: JSON.stringify({
        providerCode,
        purpose: form.purpose,
        dataCategories: ["ACCOUNT_METADATA", "BALANCES", "TRANSACTIONS"],
        periodFrom: form.periodFrom,
        periodTo: form.periodTo,
        durationDays: Number(form.durationDays),
        refreshFrequencyMinutes: 360,
        termsAccepted: true,
      }),
    }),
    onSuccess: (value) => { setResult(value); setError(null); },
    onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Could not initiate connection"),
  });

  const selected = providers.data?.items.find((provider) => provider.code === providerCode);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Connect an account</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Add a financial account</h1>
      </div>
      <Alert><AlertDescription>No bank credentials are collected here. Provider-hosted authentication is used where available. Only sandbox test-provider connectivity is configured in this environment.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose a provider</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(providers.data?.items ?? []).map((provider) => (
            <button key={provider.code} type="button" onClick={() => setProviderCode(provider.code)}
              className={`w-full rounded-lg border p-3 text-left text-sm ${providerCode === provider.code ? "border-primary bg-accent" : "border-border"}`}>
              <p className="font-medium">{provider.displayName} <span className="text-xs text-muted-foreground">({provider.mode})</span></p>
              <p className="text-[11px] text-muted-foreground">{provider.available ? "Available" : "Connection unavailable — prerequisites not met"}</p>
            </button>
          ))}
          {selected ? <p className="text-[11px] text-muted-foreground">{selected.notice}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">2. Review data sharing</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label htmlFor="purpose">Purpose</Label><Input id="purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className="mt-1.5" /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="from">Period from</Label><Input id="from" type="date" value={form.periodFrom} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} className="mt-1.5" /></div>
            <div><Label htmlFor="to">Period to</Label><Input id="to" type="date" value={form.periodTo} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} className="mt-1.5" /></div>
            <div><Label htmlFor="duration">Consent days</Label><Input id="duration" type="number" min="1" max="365" value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} className="mt-1.5" /></div>
          </div>
          <p className="text-xs text-muted-foreground">Data categories: account metadata, balances and transactions. Refresh every 6 hours. You can revoke consent at any time.</p>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            I understand this is a sandbox connection and review the data-sharing terms.
          </label>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <Button disabled={!providerCode || !accepted || connect.isPending} onClick={() => connect.mutate()}>Continue to authorisation</Button>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader><CardTitle className="text-base">3. Complete authorisation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{result.notice}</p>
            {result.authorizationUrl ? (
              <Button asChild><a href={result.authorizationUrl}>Continue to provider</a></Button>
            ) : (
              <p className="text-xs text-muted-foreground">This provider has no hosted authorisation page.</p>
            )}
            <p className="font-mono text-[10px] text-muted-foreground">Connection: {result.connectionId}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
