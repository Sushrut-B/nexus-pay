"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { CurrencyWatchlistView, RateAlertView } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, GlobalNotice } from "@/components/global/global-ui";

export default function WatchlistsPage() {
  const queryClient = useQueryClient();
  const lists = useQuery({ queryKey: ["global", "watchlists"], queryFn: () => apiFetch<{ watchlists: CurrencyWatchlistView[] }>("/api/global-finance/watchlists") });
  const alerts = useQuery({ queryKey: ["global", "alerts"], queryFn: () => apiFetch<{ alerts: RateAlertView[] }>("/api/global-finance/alerts") });
  const [watch, setWatch] = useState({ name: "", base: "USD", quote: "INR" });
  const [alert, setAlert] = useState({ base: "USD", quote: "INR", direction: "ABOVE", targetRate: "85" });
  const addWatch = useMutation({
    mutationFn: () => apiFetch("/api/global-finance/watchlists", { method: "POST", body: JSON.stringify({ name: watch.name, pairs: [{ baseCurrency: watch.base, quoteCurrency: watch.quote }] }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["global", "watchlists"] }); setWatch({ name: "", base: "USD", quote: "INR" }); },
  });
  const addAlert = useMutation({
    mutationFn: () => apiFetch("/api/global-finance/alerts", { method: "POST", body: JSON.stringify({ baseCurrency: alert.base, quoteCurrency: alert.quote, direction: alert.direction, targetRate: alert.targetRate }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["global", "alerts"] }); },
  });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Watchlists & rate alerts" description="Monitor selected pairs with source-attributed reference rates." />
      <GlobalNav />
      <GlobalNotice>Alerts are based on reference rates and are not guaranteed executable conversion opportunities. No trade is placed.</GlobalNotice>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">New watchlist</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <Input placeholder="Name" value={watch.name} onChange={(e) => setWatch({ ...watch, name: e.target.value })} />
            <Input placeholder="Base" value={watch.base} onChange={(e) => setWatch({ ...watch, base: e.target.value.toUpperCase() })} />
            <Input placeholder="Quote" value={watch.quote} onChange={(e) => setWatch({ ...watch, quote: e.target.value.toUpperCase() })} />
            <Button disabled={addWatch.isPending || watch.name.length < 2} onClick={() => addWatch.mutate()}>Add</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">New rate alert</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-5">
            <Input placeholder="Base" value={alert.base} onChange={(e) => setAlert({ ...alert, base: e.target.value.toUpperCase() })} />
            <Input placeholder="Quote" value={alert.quote} onChange={(e) => setAlert({ ...alert, quote: e.target.value.toUpperCase() })} />
            <Input placeholder="Above/Below" value={alert.direction} onChange={(e) => setAlert({ ...alert, direction: e.target.value.toUpperCase() })} />
            <Input placeholder="Target" value={alert.targetRate} onChange={(e) => setAlert({ ...alert, targetRate: e.target.value })} />
            <Button disabled={addAlert.isPending} onClick={() => addAlert.mutate()}>Create</Button>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Watchlists</CardTitle></CardHeader><CardContent>
          {(lists.data?.watchlists ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">None yet.</p> : lists.data?.watchlists.map((w) => (
            <div key={w.id} className="flex justify-between border-b border-border/70 py-2 text-sm"><span>{w.name}</span><span className="text-muted-foreground">{w.pairs.map((p) => `${p.baseCurrency}/${p.quoteCurrency}`).join(", ")}</span></div>
          ))}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Alerts</CardTitle></CardHeader><CardContent>
          {(alerts.data?.alerts ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">None yet.</p> : alerts.data?.alerts.map((a) => (
            <div key={a.id} className="flex justify-between border-b border-border/70 py-2 text-sm"><span>{a.baseCurrency}/{a.quoteCurrency} {a.direction} {a.targetRate ?? `${a.changePercentBps}bps`}</span><span className="text-muted-foreground">{a.paused ? "Paused" : "Active"}</span></div>
          ))}
        </CardContent></Card>
      </div>
    </div>
  );
}
