"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import type { InsuranceOverviewView, InsuranceProductView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function InsuranceOverviewPage() {
  const overview = useQuery({ queryKey: ["insurance", "overview"], queryFn: () => apiFetch<InsuranceOverviewView>("/api/insurance/overview") });
  const products = useQuery({ queryKey: ["insurance", "products"], queryFn: () => apiFetch<{ items: InsuranceProductView[] }>("/api/insurance/products") });
  const data = overview.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Insurance</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">Your insurance hub</h1>
      </div>
      <Alert><AlertDescription>{data?.notice ?? "No real insurer is connected. Sandbox fixtures are not real coverage."}</AlertDescription></Alert>
      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Policies" value={String(data.policies)} />
          <Metric label="Pending applications" value={String(data.pendingApplications)} />
          <Metric label="Upcoming renewals" value={String(data.upcomingRenewals)} />
          <Metric label="Claims in progress" value={String(data.claimsInProgress)} />
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Explore products</CardTitle><CardDescription>Provider-backed catalogue where available.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {(products.data?.items ?? []).slice(0, 3).map((product) => (
              <div key={product.id} className="flex justify-between text-sm">
                <Link href={`/insurance/marketplace/${encodeURIComponent(product.id)}`} className="font-medium hover:underline">{product.name}</Link>
                <span className="text-muted-foreground">{product.isSandbox ? "Sandbox" : formatMoney(product.premiumMinor ?? 0, "INR")}</span>
              </div>
            ))}
            {(products.data?.items ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No products available.</p> : null}
            <Button asChild size="sm" variant="outline"><Link href="/insurance/marketplace">Browse marketplace</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Quick actions</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline"><Link href="/insurance/compare">Compare products</Link></Button>
            <Button asChild variant="outline"><Link href="/insurance/policies">My policies</Link></Button>
            <Button asChild variant="outline"><Link href="/insurance/claims">Claims</Link></Button>
            <Button asChild variant="outline"><Link href="/insurance/privacy">Privacy & consent</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}

