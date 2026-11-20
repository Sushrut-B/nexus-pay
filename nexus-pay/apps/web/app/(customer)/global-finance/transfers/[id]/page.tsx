"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { InternationalTransferView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { GlobalHeader, GlobalNav, Metric } from "@/components/global/global-ui";

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const query = useQuery({ queryKey: ["global", "transfer", params.id], queryFn: () => apiFetch<InternationalTransferView>(`/api/international-payments/transfers/${params.id}`) });
  const t = query.data;
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Transfer details" description="Provider-confirmed outcomes only. Wallet settlement remains authoritative in Raftline." />
      <GlobalNav />
      {t ? (
        <>
          <Alert><AlertDescription>{t.notice}</AlertDescription></Alert>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="State" value={t.state} />
            <Metric label="Source" value={formatMoney(t.sourceMinor, t.sourceCurrency)} />
            <Metric label="Compliance" value={t.complianceState} />
            <Metric label="Provider ref" value={t.providerRef ?? "None"} />
            <Metric label="Wallet settlement" value={t.walletSettlementRef ?? "Not settled"} />
            <Metric label="Provider" value={t.providerCode} />
          </div>
          <Card><CardHeader><CardTitle className="text-base">Financial invariants</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
            <p>A successful wallet debit does not imply transfer success. No recipient is credited without provider confirmation.</p>
            <p>Uncertain outcomes remain UNKNOWN / RECONCILIATION_REQUIRED and are resolved by the original provider reference.</p>
          </CardContent></Card>
        </>
      ) : <p className="text-sm text-muted-foreground">Loading transferâ€¦</p>}
    </div>
  );
}
