"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { ForeignAssetLiabilityView } from "@nexus/shared-types";
import { formatByCurrency } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, GlobalNotice } from "@/components/global/global-ui";

export default function ForeignAssetsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["global", "assets"], queryFn: () => apiFetch<{ items: ForeignAssetLiabilityView[] }>("/api/global-finance/assets") });
  const [form, setForm] = useState({ kind: "ASSET", label: "", originalMinor: "0", originalCurrency: "USD", valuationDate: new Date().toISOString().slice(0, 10) });
  const mutation = useMutation({
    mutationFn: () => apiFetch("/api/global-finance/assets", { method: "POST", body: JSON.stringify({ ...form, originalMinor: Number(form.originalMinor), valuationDate: new Date(form.valuationDate).toISOString() }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["global", "assets"] }); setForm({ ...form, label: "" }); },
  });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Foreign assets & liabilities" description="Original-currency values with a recorded valuation rate and source. No asset is double-counted with the wealth engine." />
      <GlobalNav />
      <GlobalNotice>Converted values use the rate recorded at valuation time, not a current market quote. User-reported values are not independently verified.</GlobalNotice>
      <Card><CardHeader><CardTitle className="text-base">Add a valuation</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-6">
        <Input placeholder="ASSET/LIABILITY" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value.toUpperCase() })} />
        <Input placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <Input placeholder="Minor units" value={form.originalMinor} onChange={(e) => setForm({ ...form, originalMinor: e.target.value })} />
        <Input placeholder="Currency" value={form.originalCurrency} onChange={(e) => setForm({ ...form, originalCurrency: e.target.value.toUpperCase() })} />
        <Input placeholder="Valuation date" value={form.valuationDate} onChange={(e) => setForm({ ...form, valuationDate: e.target.value })} />
        <Button disabled={mutation.isPending || form.label.length < 2} onClick={() => mutation.mutate()}>Add</Button>
      </CardContent></Card>
      <div className="rounded-2xl border border-border bg-card p-5">
        {(query.data?.items ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No foreign assets or liabilities recorded.</p> : query.data?.items.map((item) => (
          <div key={item.id} className="flex flex-wrap justify-between gap-2 border-b border-border/70 py-3 text-sm">
            <div><p className="font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.kind} Â· {item.verificationStatus} Â· {item.rateSource ?? "no rate"}</p></div>
            <div className="text-right"><p>{formatByCurrency(item.originalMinor, item.originalCurrency)}</p><p className="text-xs text-muted-foreground">{item.convertedMinor == null ? "No converted value" : `â‰ˆ ${formatByCurrency(item.convertedMinor, item.displayCurrency)}`}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}
