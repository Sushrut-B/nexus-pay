"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { CampaignView } from "@nexus/shared-types";
import { REWARD_CAMPAIGN_TYPES } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function MerchantRewardsPage() {
  const queryClient = useQueryClient();
  const campaigns = useQuery({ queryKey: ["merchant", "rewards", "campaigns"], queryFn: () => apiFetch<{ items: CampaignView[] }>("/api/merchant/rewards/campaigns") });
  const analytics = useQuery({
    queryKey: ["merchant", "rewards", "analytics"],
    queryFn: () => apiFetch<{ campaigns: number; activeCampaigns: number; redemptions: number; cashbackCreditedMinor: number; budgetMinor: number; consumedMinor: number }>("/api/merchant/rewards/analytics"),
  });
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", type: "CASHBACK", startAt: "", endAt: "",
    minSpend: "500", maxReward: "100", budget: "10000", cashbackBps: "1000",
    pointsPerMinor: "5", promoCode: "",
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiFetch("/api/merchant/rewards/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        type: form.type,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        minSpendMinor: Math.round(Number(form.minSpend) * 100),
        maxRewardMinor: Math.round(Number(form.maxReward) * 100),
        budgetMinor: Math.round(Number(form.budget) * 100),
        cashbackBps: Number(form.cashbackBps) || 0,
        pointsPerMinor: Number(form.pointsPerMinor) || 0,
        promoCode: form.promoCode || undefined,
      }),
    }),
    onSuccess: () => {
      setShow(false); setError(null);
      void queryClient.invalidateQueries({ queryKey: ["merchant", "rewards"] });
      toast.success("Campaign created as draft");
    },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not create campaign"),
  });
  const submit = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/merchant/rewards/campaigns/${encodeURIComponent(id)}/submit`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["merchant", "rewards", "campaigns"] }); toast.success("Submitted for approval"); },
  });
  const pause = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/merchant/rewards/campaigns/${encodeURIComponent(id)}/pause`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["merchant", "rewards", "campaigns"] }); toast.success("Campaign paused"); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Offers & loyalty</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Campaigns</h1>
        </div>
        <Button onClick={() => setShow((value) => !value)}>{show ? "Close" : "New campaign"}</Button>
      </div>
      <Alert><AlertDescription>Campaigns start as DRAFT and require Nexus Control approval before activation. Merchants cannot issue wallet credits or modify global reward balances.</AlertDescription></Alert>

      {analytics.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Campaigns" value={String(analytics.data.campaigns)} />
          <Metric label="Active" value={String(analytics.data.activeCampaigns)} />
          <Metric label="Redemptions" value={String(analytics.data.redemptions)} />
          <Metric label="Cashback credited" value={formatMoney(analytics.data.cashbackCreditedMinor, "INR")} />
        </div>
      ) : null}

      {show ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="camp-name">Name</Label><Input id="camp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="camp-type">Type</Label><select id="camp-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{REWARD_CAMPAIGN_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div>
              <div><Label htmlFor="camp-start">Starts</Label><Input id="camp-start" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="camp-end">Ends</Label><Input id="camp-end" type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="camp-min">Min spend (INR)</Label><Input id="camp-min" value={form.minSpend} onChange={(e) => setForm({ ...form, minSpend: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="camp-max">Max reward (INR)</Label><Input id="camp-max" value={form.maxReward} onChange={(e) => setForm({ ...form, maxReward: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="camp-budget">Budget (INR)</Label><Input id="camp-budget" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="camp-bps">Cashback bps</Label><Input id="camp-bps" value={form.cashbackBps} onChange={(e) => setForm({ ...form, cashbackBps: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="camp-points">Points per ₹100</Label><Input id="camp-points" value={form.pointsPerMinor} onChange={(e) => setForm({ ...form, pointsPerMinor: e.target.value })} className="mt-1.5" /></div>
              <div><Label htmlFor="camp-promo">Promo code (optional)</Label><Input id="camp-promo" value={form.promoCode} onChange={(e) => setForm({ ...form, promoCode: e.target.value })} className="mt-1.5" /></div>
            </div>
            <div><Label htmlFor="camp-desc">Description</Label><Input id="camp-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" /></div>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button disabled={!form.name || !form.startAt || !form.endAt || create.isPending} onClick={() => create.mutate()}>Create draft</Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">All campaigns</CardTitle></CardHeader>
        <CardContent>
          {(campaigns.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No campaigns yet.</p> : (
            <div className="divide-y divide-border/70">
              {campaigns.data?.items.map((campaign) => (
                <div key={campaign.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{campaign.name}</p>
                    <p className="text-[10px] text-muted-foreground">{campaign.type.replaceAll("_", " ")} · {formatDateTime(campaign.startAt)} · {campaign.status}</p>
                  </div>
                  <p className="text-xs">{formatMoney(campaign.budgetMinor, "INR")}</p>
                  {campaign.status === "DRAFT" ? <Button size="sm" variant="outline" disabled={submit.isPending} onClick={() => submit.mutate(campaign.id)}>Submit</Button> : null}
                  {["ACTIVE", "APPROVED", "SCHEDULED"].includes(campaign.status) ? <Button size="sm" variant="ghost" disabled={pause.isPending} onClick={() => pause.mutate(campaign.id)}>Pause</Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-semibold text-navy">{value}</p></div>;
}
