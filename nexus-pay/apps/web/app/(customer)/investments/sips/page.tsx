"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { SipView, SipProjection } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function SipsPage() {
  const queryClient = useQueryClient();
  const sips = useQuery({ queryKey: ["investments", "sips"], queryFn: () => apiFetch<{ items: SipView[] }>("/api/investments/sips") });
  const [monthly, setMonthly] = useState("10000");
  const [months, setMonths] = useState("60");
  const [rate, setRate] = useState("700");
  const [projection, setProjection] = useState<SipProjection | null>(null);
  const calculate = useMutation({
    mutationFn: () => apiFetch<SipProjection>("/api/investments/sip/calculator", {
      method: "POST", body: JSON.stringify({ monthlyMinor: Number(monthly) * 100, months: Number(months), assumedReturnBps: Number(rate), frequency: "MONTHLY" }),
    }),
    onSuccess: (data) => { setProjection(data); void queryClient.invalidateQueries({ queryKey: ["investments", "plans"] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">SIPs</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">SIP tracking & planner</h1>
      </div>
      <Alert><AlertDescription>A projection is a hypothetical estimate from your assumptions, not a guaranteed return. Saving a plan never creates a real SIP mandate. Actual registration, pause or cancellation requires an authorized provider.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Hypothetical SIP calculator</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="monthly">Monthly amount (₹)</Label><Input id="monthly" type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} className="mt-1.5" /></div>
            <div><Label htmlFor="months">Duration (months)</Label><Input id="months" type="number" value={months} onChange={(e) => setMonths(e.target.value)} className="mt-1.5" /></div>
            <div><Label htmlFor="rate">Assumed annual return (%)</Label><Input id="rate" type="number" step="0.5" value={Number(rate) / 100} onChange={(e) => setRate(String(Math.round(Number(e.target.value) * 100)))} className="mt-1.5" /></div>
          </div>
          <Button disabled={calculate.isPending} onClick={() => calculate.mutate()}>Calculate</Button>
          {projection ? (
            <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm">
              <p>Total invested: {formatMoney(projection.totalInvestedMinor, "INR")}</p>
              <p>Estimated returns: {formatMoney(projection.estimatedReturnsMinor, "INR")}</p>
              <p className="font-medium">Estimated maturity: {formatMoney(projection.estimatedMaturityMinor, "INR")}</p>
              <p className="mt-2 text-xs text-muted-foreground">{projection.notice}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Tracked SIPs</CardTitle></CardHeader>
        <CardContent>
          {(sips.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No provider-reported SIPs.</p> : (
            <div className="divide-y divide-border/70">
              {sips.data?.items.map((sip) => (
                <div key={sip.id} className="flex justify-between py-3 text-sm">
                  <div><p className="font-medium">{sip.schemeName}</p><p className="text-xs text-muted-foreground">{sip.status} · {sip.instalmentsCompleted} instalments · sandbox fixture</p></div>
                  <div className="text-right"><p>{formatMoney(sip.amountMinor, "INR")} / {sip.frequency}</p><p className="text-xs text-muted-foreground">{sip.nextInstalmentDate ? new Date(sip.nextInstalmentDate).toLocaleDateString("en-IN") : "—"}</p></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
