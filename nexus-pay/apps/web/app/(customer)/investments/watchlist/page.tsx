"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { WatchlistView, InstrumentView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function WatchlistPage() {
  const queryClient = useQueryClient();
  const lists = useQuery({ queryKey: ["investments", "watchlists"], queryFn: () => apiFetch<{ items: WatchlistView[] }>("/api/investments/watchlists") });
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstrumentView[]>([]);
  const create = useMutation({
    mutationFn: () => apiFetch("/api/investments/watchlists", { method: "POST", body: JSON.stringify({ name, isDefault: false }) }),
    onSuccess: () => { setName(""); void queryClient.invalidateQueries({ queryKey: ["investments", "watchlists"] }); },
  });
  const search = useMutation({
    mutationFn: () => apiFetch<{ items: InstrumentView[] }>(`/api/investments/instruments?q=${encodeURIComponent(query)}`),
    onSuccess: (data) => setResults(data.items),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Watchlist</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Watchlists & price alerts</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">New watchlist</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <div><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-56" /></div>
          <Button disabled={name.length < 2 || create.isPending} onClick={() => create.mutate()}>Create</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Find an instrument</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" /><Button onClick={() => search.mutate()}>Search</Button></div>
          {results.map((item) => <p key={item.id} className="text-xs">{item.symbol} · {item.name} · {item.priceMinor === null ? "Price unavailable" : formatMoney(item.priceMinor, "INR")}</p>)}
        </CardContent>
      </Card>
      {(lists.data?.items ?? []).map((list) => (
        <Card key={list.id}>
          <CardHeader><CardTitle className="text-base">{list.name}</CardTitle></CardHeader>
          <CardContent>
            {list.items.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Empty watchlist.</p> : (
              <div className="divide-y divide-border/70">
                {list.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 text-xs"><span>{item.symbol}</span><span className="text-muted-foreground">{item.priceMinor === null ? "Unavailable" : formatMoney(item.priceMinor, "INR")} · {item.feedType}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {(lists.data?.items ?? []).length === 0 ? <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">No watchlists yet.</CardContent></Card> : null}
    </div>
  );
}
