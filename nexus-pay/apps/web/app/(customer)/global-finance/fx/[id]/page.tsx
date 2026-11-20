"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FxQuoteView } from "@nexus/shared-types";
import { formatByCurrency } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, Metric } from "@/components/global/global-ui";

export default function FxQuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["global", "quote", params.id], queryFn: () => apiFetch<FxQuoteView>(`/api/global-finance/fx/quotes/${params.id}`) });
  const confirm = useMutation({
    mutationFn: () => apiFetch(`/api/global-finance/fx/quotes/${params.id}/confirm`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["global", "quote", params.id] }); },
  });
  const q = query.data;
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="FX quote details" description="Indicative quote for planning only. No execution, debit or settlement is performed." />
      <GlobalNav />
      {q ? (
        <>
          <Alert><AlertDescription>{q.notice}</AlertDescription></Alert>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="State" value={q.state} />
            <Metric label="You pay" value={formatByCurrency(q.sourceMinor, q.sourceCurrency)} />
            <Metric label="Estimated receive" value={q.targetMinor == null ? "â€”" : formatByCurrency(q.targetMinor, q.targetCurrency)} />
            <Metric label="Rate / class" value={`${q.rate ?? "â€”"} / ${q.classification}`} />
            <Metric label="Provider" value={q.providerCode} />
            <Metric label="Fee" value={q.providerFeeMinor == null ? "Not included" : formatByCurrency(q.providerFeeMinor, q.sourceCurrency)} />
            <Metric label="Taxes" value={q.taxMinor == null ? "Not included" : formatByCurrency(q.taxMinor, q.sourceCurrency)} />
            <Metric label="Expires" value={q.expiresAt ? new Date(q.expiresAt).toLocaleString("en-IN") : "â€”"} />
          </div>
          <Card><CardHeader><CardTitle className="text-base">Customer confirmation</CardTitle></CardHeader><CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Confirming acknowledges the indicative quote for planning. It does not execute a conversion.</p>
            <Button disabled={confirm.isPending || q.state === "QUOTE_EXPIRED"} onClick={() => confirm.mutate()}>Confirm for planning</Button>
          </CardContent></Card>
        </>
      ) : <p className="text-sm text-muted-foreground">Loading quoteâ€¦</p>}
    </div>
  );
}
