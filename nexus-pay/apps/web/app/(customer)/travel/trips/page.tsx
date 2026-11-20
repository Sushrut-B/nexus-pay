"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { TravelTripView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function TravelTripsPage() {
  const queryClient = useQueryClient();
  const trips = useQuery({ queryKey: ["travel", "trips"], queryFn: () => apiFetch<{ items: TravelTripView[] }>("/api/travel/trips") });
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const itinerary = useQuery({
    queryKey: ["travel", "itinerary", selected],
    enabled: Boolean(selected),
    queryFn: () => apiFetch<{ items: Array<{ id: string; title: string; localStart: string; startTimeZone: string }> }>(`/api/travel/trips/${selected}/itinerary`),
  });
  const budget = useQuery({
    queryKey: ["travel", "budget", selected],
    enabled: Boolean(selected),
    queryFn: () => apiFetch<{ amountMinor: number; spentMinor: number; remainingMinor: number; currency: string }>(`/api/travel/trips/${selected}/budget`),
  });
  const create = useMutation({
    mutationFn: () => apiFetch("/api/travel/trips", { method: "POST", body: JSON.stringify({ name, destination: destination || undefined }) }),
    onSuccess: () => { setName(""); setDestination(""); void queryClient.invalidateQueries({ queryKey: ["travel", "trips"] }); toast.success("Trip created"); },
    onError: () => toast.error("Could not create the trip"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Trips</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">My trips</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Create a trip</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="name">Trip name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-48" /></div>
          <div><Label htmlFor="destination">Destination</Label><Input id="destination" value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1.5 w-48" /></div>
          <Button disabled={name.length < 2 || create.isPending} onClick={() => create.mutate()}>Create trip</Button>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Your trips</CardTitle></CardHeader>
          <CardContent>
            {(trips.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No trips yet.</p> : (
              <div className="divide-y divide-border/70">
                {trips.data?.items.map((trip) => (
                  <button key={trip.id} className="flex w-full justify-between py-3 text-left text-sm" onClick={() => setSelected(trip.id)}>
                    <span>{trip.name}</span><span className="text-xs text-muted-foreground">{trip.destination ?? "—"}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Itinerary & budget</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!selected ? <p className="py-8 text-center text-xs text-muted-foreground">Select a trip to view its itinerary.</p> : (
              <>
                <p className="text-xs text-muted-foreground">Times are shown in each event local time zone.</p>
                {(itinerary.data?.items ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No itinerary items yet.</p> : (
                  <ol className="space-y-2">
                    {itinerary.data?.items.map((item) => <li key={item.id} className="rounded-lg border border-border p-2 text-xs"><p className="font-medium">{item.title}</p><p className="text-muted-foreground">{item.localStart} ({item.startTimeZone})</p></li>)}
                  </ol>
                )}
                {budget.data ? <p className="text-xs">Budget: {budget.data.amountMinor} · Spent: {budget.data.spentMinor} · Remaining: {budget.data.remainingMinor} {budget.data.currency}</p> : <p className="text-xs text-muted-foreground">No budget set.</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
