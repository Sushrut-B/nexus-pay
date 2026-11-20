"use client";

import { Suspense, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { TravelSearchView, TravelProviderView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

const CATEGORIES = ["FLIGHT", "TRAIN", "BUS", "HOTEL", "CAB", "AIRPORT_TRANSFER", "LOCAL_MOBILITY"];

function SearchForm({ onResult }: { onResult: (view: TravelSearchView) => void }) {
  const params = useSearchParams();
  const initial = params.get("category") ?? "FLIGHT";
  const [category, setCategory] = useState(CATEGORIES.includes(initial) ? initial : "FLIGHT");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [passengers, setPassengers] = useState("1");
  const providers = useQuery({ queryKey: ["travel", "providers"], queryFn: () => apiFetch<{ items: TravelProviderView[] }>("/api/travel/providers") });
  const available = (providers.data?.items ?? []).filter((item) => item.available).length > 0;
  const search = useMutation({
    mutationFn: () => apiFetch<TravelSearchView>("/api/travel/search", {
      method: "POST",
      body: JSON.stringify({
        category,
        origin: origin || undefined,
        destination,
        departureDate: departureDate ? new Date(departureDate).toISOString() : undefined,
        passengers: Number(passengers),
      }),
    }),
    onSuccess: onResult,
    onError: () => toast.error("Search is unavailable for this category"),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Search travel options</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="category">Category</Label>
            <select id="category" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
              {CATEGORIES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          <div><Label htmlFor="destination">Destination</Label><Input id="destination" value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="origin">Origin (optional)</Label><Input id="origin" value={origin} onChange={(e) => setOrigin(e.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="date">Departure date</Label><Input id="date" type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} className="mt-1.5" /></div>
          <div><Label htmlFor="passengers">Passengers</Label><Input id="passengers" type="number" min={1} max={9} value={passengers} onChange={(e) => setPassengers(e.target.value)} className="mt-1.5 w-28" /></div>
        </div>
        {!available ? <p className="text-xs text-amber-700">No provider is connected. Search will return an honest unavailable state.</p> : null}
        <Button disabled={destination.length < 2 || search.isPending} onClick={() => search.mutate()}>Search</Button>
      </CardContent>
    </Card>
  );
}

export default function TravelSearchPage() {
  const [result, setResult] = useState<TravelSearchView | null>(null);
  const [revalidated, setRevalidated] = useState<Record<string, { amountMinor: number; validUntil: string | null }>>({});
  const revalidate = useMutation({
    mutationFn: ({ searchId, resultId }: { searchId: string; resultId: string }) => apiFetch<{ amountMinor: number; validUntil: string | null }>(`/api/travel/products/${encodeURIComponent(resultId)}/revalidate`, {
      method: "POST", body: JSON.stringify({ searchId, resultId }),
    }),
    onSuccess: (data, vars) => { setRevalidated((current) => ({ ...current, [vars.resultId]: data })); toast.success("Fare revalidated with provider"); },
    onError: () => toast.error("Fare could not be revalidated"),
  });
  const [bookingResult, setBookingResult] = useState<string | null>(null);
  const book = useMutation({
    mutationFn: ({ resultId, amountMinor }: { resultId: string; amountMinor: number }) => apiFetch<{ reference: string }>("/api/travel/bookings", {
      method: "POST",
      body: JSON.stringify({
        searchId: result!.id, resultId, amountMinor,
        passengers: [{ firstName: "Test", lastName: "Traveller" }],
        idempotencyKey: `travel-${Date.now()}-${resultId}`,
        termsAccepted: true,
      }),
    }),
    onSuccess: (data) => setBookingResult(data.reference),
    onError: () => toast.error("Booking draft could not be created"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Discovery</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Find your journey</h1>
      </div>
      <Alert><AlertDescription>Search results are provider-reported and may be stale. A stored fare must be revalidated before booking. Sandbox results are test fixtures.</AlertDescription></Alert>
      <Suspense fallback={<div className="text-xs text-muted-foreground">Loading search…</div>}>
        <SearchForm onResult={(view) => { setResult(view); setRevalidated({}); setBookingResult(null); }} />
      </Suspense>
      {result ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Results ({result.results.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {result.results.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No provider results available.</p> : result.results.map((item) => {
              const fresh = revalidated[item.id];
              return (
                <div key={item.id} className="rounded-xl border border-border p-4 text-sm">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.category} · fetched {new Date(item.retrievedAt).toLocaleString("en-IN")} · {item.isSandbox ? "SANDBOX FIXTURE" : item.source}</p>
                  <p className="mt-1">Fare: {item.amountMinor === null ? "Unavailable" : formatMoney(fresh?.amountMinor ?? item.amountMinor, item.currency)} {fresh ? "(revalidated)" : "(cached)"}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" disabled={revalidate.isPending} onClick={() => revalidate.mutate({ searchId: result.id, resultId: item.id })}>Revalidate fare</Button>
                    {fresh ? <Button size="sm" disabled={book.isPending} onClick={() => book.mutate({ resultId: item.id, amountMinor: fresh.amountMinor })}>Continue to booking</Button> : null}
                  </div>
                </div>
              );
            })}
            {bookingResult ? <p className="text-xs text-emerald-700">Booking draft {bookingResult} created. Wallet debit and provider confirmation are tracked separately.</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
