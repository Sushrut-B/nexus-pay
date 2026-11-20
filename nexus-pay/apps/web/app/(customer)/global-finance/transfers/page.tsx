"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { InternationalTransferView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { GlobalHeader, GlobalNav, GlobalNotice } from "@/components/global/global-ui";

export default function TransfersPage() {
  const query = useQuery({ queryKey: ["global", "transfers"], queryFn: () => apiFetch<{ transfers: InternationalTransferView[] }>("/api/international-payments/transfers") });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="International transfers" description="Transfer records exist only as provider-ready previews unless an authorized provider is enabled." />
      <GlobalNav />
      <GlobalNotice>No wallet debit occurs for a preview record. Unknown outcomes are reconciled by the original provider reference, never by blind retry.</GlobalNotice>
      <Card><CardHeader><CardTitle className="text-base">Transfer records</CardTitle></CardHeader><CardContent>
        {(query.data?.transfers ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No transfer records.</p> : query.data?.transfers.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 py-3 text-sm">
            <div><p className="font-medium">{t.sourceCurrency} â†’ {t.targetCurrency} Â· {formatMoney(t.sourceMinor, t.sourceCurrency)}</p><p className="text-xs text-muted-foreground">{t.state} Â· {t.complianceState} Â· {t.providerCode}</p></div>
            <Button asChild variant="outline" size="sm"><Link href={`/global-finance/transfers/${t.id}`}>View details</Link></Button>
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}
