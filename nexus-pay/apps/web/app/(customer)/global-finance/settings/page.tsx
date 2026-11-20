"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { GlobalHeader, GlobalNav, GlobalNotice, Metric } from "@/components/global/global-ui";

interface CurrencyDef { code: string; name: string; exponent: number; transactableWallet: boolean }

export default function GlobalSettingsPage() {
  const queryClient = useQueryClient();
  const currencies = useQuery({ queryKey: ["global", "currencies"], queryFn: () => apiFetch<{ currencies: CurrencyDef[] }>("/api/global-finance/currencies") });
  const pref = useQuery({ queryKey: ["global", "preferences"], queryFn: () => apiFetch<{ displayCurrency: string }>("/api/global-finance/preferences") });
  const [choice, setChoice] = useState(pref.data?.displayCurrency ?? "INR");
  const save = useMutation({
    mutationFn: () => apiFetch("/api/global-finance/preferences", { method: "PUT", body: JSON.stringify({ currency: choice }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["global", "preferences"] }); void queryClient.invalidateQueries({ queryKey: ["global", "dashboard"] }); },
  });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Global Finance settings" description="Choose a display currency and review the configured currency catalogue." />
      <GlobalNav />
      <GlobalNotice>Selecting a display currency does NOT change your wallet currency. INR remains the only transactable Nexus Pay wallet currency.</GlobalNotice>
      <Card><CardHeader><CardTitle className="text-base">Preferred display currency</CardTitle></CardHeader><CardContent className="flex flex-wrap items-end gap-3">
        <Input className="w-32" placeholder="Currency" value={choice} onChange={(e) => setChoice(e.target.value.toUpperCase())} />
        <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        <span className="text-xs text-muted-foreground">Current: {pref.data?.displayCurrency ?? "â€”"}</span>
      </CardContent></Card>
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-navy">Configured currencies</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(currencies.data?.currencies ?? []).map((c) => (
            <div key={c.code} className="rounded-xl border border-border p-3">
              <p className="font-mono text-sm font-semibold">{c.code}</p>
              <p className="text-xs text-muted-foreground">{c.name}</p>
              <Metric label="Minor exponent" value={String(c.exponent)} />
              <p className="mt-2 text-[11px] text-muted-foreground">{c.transactableWallet ? "Wallet settlement supported" : "Tracking / valuation only"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
