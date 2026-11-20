"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { TravelBookingView, TravelProviderView } from "@nexus/shared-types";

export default function TravelHomePage() {
  const providers = useQuery({ queryKey: ["travel", "providers"], queryFn: () => apiFetch<{ items: TravelProviderView[] }>("/api/travel/providers") });
  const bookings = useQuery({ queryKey: ["travel", "bookings"], queryFn: () => apiFetch<{ items: TravelBookingView[] }>("/api/travel/bookings") });
  const available = (providers.data?.items ?? []).filter((item) => item.available).length;
  const categories = ["FLIGHT", "TRAIN", "BUS", "HOTEL", "CAB", "AIRPORT_TRANSFER", "LOCAL_MOBILITY"];
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Travel</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">Plan your next journey</h1>
      </div>
      <Alert><AlertDescription>No real travel provider is connected. Sandbox results are labelled test fixtures, not real availability or prices. A wallet debit never proves a booking is confirmed.</AlertDescription></Alert>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Connected providers</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{available}</p></div>
        <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bookings</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{(bookings.data?.items ?? []).length}</p></div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">What would you like to book?</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {categories.map((category) => (
              <Link key={category} href={`/travel/search?category=${category}`} className="rounded-xl border border-border bg-secondary/30 p-3 text-center text-xs font-medium hover:border-primary/50">
                {category.replaceAll("_", " ")}
              </Link>
            ))}
          </div>
          <Button asChild className="mt-4" size="sm"><Link href="/travel/search">Start a search</Link></Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent bookings</CardTitle></CardHeader>
        <CardContent>
          {(bookings.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No bookings yet.</p> : (
            <div className="divide-y divide-border/70">
              {bookings.data?.items.slice(0, 5).map((booking) => (
                <div key={booking.id} className="flex justify-between py-2 text-xs">
                  <span>{booking.category} · {booking.providerName}</span>
                  <span className="text-muted-foreground">{booking.notice}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
