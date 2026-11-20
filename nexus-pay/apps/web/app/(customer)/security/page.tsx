"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";

interface Overview {
  events24h: number; evaluations24h: number; activeAlerts: number; reports: number;
  notice: string; currency: string;
}

export default function SecurityOverviewPage() {
  const query = useQuery({ queryKey: ["security", "overview"], queryFn: () => apiFetch<Overview>("/api/security/overview") });
  const data = query.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Security</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">Your security overview</h1>
      </div>
      <Alert><AlertDescription>{data?.notice ?? "Risk scores are indicators, not proof of fraud. No funds are frozen automatically."}</AlertDescription></Alert>
      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Security events (24h)" value={String(data.events24h)} />
          <Metric label="Risk evaluations (24h)" value={String(data.evaluations24h)} />
          <Metric label="Active alerts" value={String(data.activeAlerts)} />
          <Metric label="Reports filed" value={String(data.reports)} />
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Stay in control</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline"><Link href="/security/sessions">Manage sessions</Link></Button>
            <Button asChild variant="outline"><Link href="/security/devices">Trusted devices</Link></Button>
            <Button asChild variant="outline"><Link href="/security/safety">Safety centre</Link></Button>
            <Button asChild variant="outline"><Link href="/security/reports">Report an issue</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">What we will never ask</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Nexus Pay will never ask for your password, OTP, UPI PIN or remote device access.</p>
            <p>A risk warning does not mean fraud was confirmed, and it does not move money.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
