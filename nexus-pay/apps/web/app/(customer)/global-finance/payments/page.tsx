"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { CorridorView, InternationalProviderView } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav } from "@/components/global/global-ui";

export default function InternationalPaymentsPage() {
  const providers = useQuery({ queryKey: ["global", "intl-providers"], queryFn: () => apiFetch<{ providers: InternationalProviderView[] }>("/api/international-payments/providers") });
  const corridors = useQuery({ queryKey: ["global", "corridors"], queryFn: () => apiFetch<{ corridors: CorridorView[] }>("/api/international-payments/corridors") });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="International payments" description="Provider-ready architecture. No transfer can be executed until a verified, authorized provider is integrated." />
      <GlobalNav />
      <Alert><AlertDescription>International transfers are UNAVAILABLE. Nexus Pay is not a bank, authorised dealer or remittance provider. No money is moved and no wallet is debited here.</AlertDescription></Alert>
      <Card><CardHeader><CardTitle className="text-base">Providers</CardTitle></CardHeader><CardContent>
        {(providers.data?.providers ?? []).map((p) => (
          <div key={p.code} className="border-b border-border/70 py-3 text-sm">
            <p className="font-medium">{p.displayName} <span className="ml-2 text-xs text-muted-foreground">{p.available ? "AVAILABLE" : "UNAVAILABLE"}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">{p.notice}</p>
            <p className="mt-1 text-xs text-muted-foreground">Capabilities: {Object.entries(p.capabilities).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}</p>
          </div>
        ))}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Corridors</CardTitle></CardHeader><CardContent>
        {(corridors.data?.corridors ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No corridors configured.</p> : corridors.data?.corridors.map((c) => (
          <div key={c.id} className="flex justify-between border-b border-border/70 py-2 text-sm"><span>{c.sourceCountry} â†’ {c.destinationCountry} ({c.sourceCurrency}/{c.targetCurrency})</span><span className="text-muted-foreground">{c.enabled ? "Enabled" : "Disabled"}</span></div>
        ))}
      </CardContent></Card>
    </div>
  );
}
