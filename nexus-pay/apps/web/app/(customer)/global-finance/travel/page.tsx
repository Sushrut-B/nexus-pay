"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { TravelCurrencyView } from "@nexus/shared-types";
import { formatByCurrency } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav } from "@/components/global/global-ui";

export default function TravelCurrencyPage() {
  const query = useQuery({ queryKey: ["global", "travel"], queryFn: () => apiFetch<{ trips: TravelCurrencyView[] }>("/api/global-finance/travel") });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Travel currency" description="Trip budgets, spending and user-reported cash in their original currencies." />
      <GlobalNav />
      <Alert><AlertDescription>Cash entries are user-reported. Nexus Pay does not provide FX cash delivery or card-based international spending.</AlertDescription></Alert>
      {(query.data?.trips ?? []).length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No trips available. Create a trip in the Travel module first.</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {query.data?.trips.map((trip) => (
            <Card key={trip.tripId}>
              <CardHeader><CardTitle className="text-base">{trip.destination ?? "Trip"} Â· {trip.tripCurrency}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Budget: {trip.budgetMinor == null ? "â€”" : formatByCurrency(trip.budgetMinor, trip.tripCurrency)}</p>
                <p>Spent: {formatByCurrency(trip.spentMinor, trip.tripCurrency)}{trip.convertedSpentMinor != null ? ` â‰ˆ ${formatByCurrency(trip.convertedSpentMinor, trip.displayCurrency)}` : ""}</p>
                <p>Cash remaining (user-reported): {trip.cashRemainingMinor == null ? "â€”" : formatByCurrency(trip.cashRemainingMinor, trip.tripCurrency)}</p>
                <p className="text-xs text-muted-foreground">{trip.notice}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
