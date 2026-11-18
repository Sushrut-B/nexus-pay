"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { ReferralView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { useState } from "react";



export default function ReferralsPage() {
  const referral = useQuery({ queryKey: ["rewards", "referrals"], queryFn: () => apiFetch<ReferralView>("/api/rewards/referrals") });
  const [code, setCode] = useState("");
  const data = referral.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Invite friends</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Referrals</h1>
      </div>
      {data ? (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Your referral code</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="font-mono text-2xl font-semibold text-navy">{data.code}</p>
              <p className="break-all text-xs text-muted-foreground">{data.link}</p>
              <div className="flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Friend's referral code" aria-label="Referral code" />
              </div>
              <p className="text-xs text-muted-foreground">A referral qualifies when your friend registers, completes onboarding and makes one settled merchant payment.</p>
            </CardContent>
          </Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Referred" value={String(data.referredCount)} />
            <Metric label="Qualified" value={String(data.qualifiedCount)} />
            <Metric label="Points earned" value={data.pointsEarned.toLocaleString("en-IN")} />
          </div>
          <Alert><AlertDescription>Self-referrals and duplicate referrals are rejected. Rewards are issued only after qualification.</AlertDescription></Alert>
          <Card>
            <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
            <CardContent>
              {data.history.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No referrals yet.</p> : (
                <div className="divide-y divide-border/70">
                  {data.history.map((item, index) => (
                    <div key={`${item.createdAt}-${index}`} className="flex items-center justify-between py-2 text-xs">
                      <span>{item.type}</span>
                      <span className="text-muted-foreground">{item.status} · {formatDateTime(item.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}

