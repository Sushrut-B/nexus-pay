"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { ForecastView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function ForecastsPage() {
  const queryClient = useQueryClient();
  const forecast = useQuery({ queryKey: ["finance", "forecast"], queryFn: () => apiFetch<ForecastView>("/api/finance/forecasts") });
  const refresh = useMutation({
    mutationFn: () => apiFetch("/api/finance/forecasts/refresh", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["finance", "forecast"] }); toast.success("Forecast refreshed"); },
    onError: () => toast.error("Could not refresh forecast"),
  });
  const data = forecast.data;
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Forecasting</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Forecasts</h1>
        </div>
        <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>Refresh forecast</Button>
      </div>
      {data ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{data.kind.replaceAll("_", " ")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!data.available ? (
              <Alert><AlertDescription>{data.reason}</AlertDescription></Alert>
            ) : (
              <>
                <p className="font-display text-3xl font-semibold text-navy">{formatMoney(data.predictedMinor, data.currency)}</p>
                <p className="text-xs text-muted-foreground">Uncertainty range: {formatMoney(data.lowMinor, data.currency)} – {formatMoney(data.highMinor, data.currency)}</p>
                <p className="text-xs text-muted-foreground">Method: {data.method} · based on {data.historyCount} historical records</p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{data.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
                <Alert><AlertDescription>This is an estimate, not a guaranteed outcome.</AlertDescription></Alert>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
