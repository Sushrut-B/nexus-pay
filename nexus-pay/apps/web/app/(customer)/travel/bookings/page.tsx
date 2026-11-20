"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { TravelBookingView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function TravelBookingsPage() {
  const bookings = useQuery({ queryKey: ["travel", "bookings"], queryFn: () => apiFetch<{ items: TravelBookingView[] }>("/api/travel/bookings") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Bookings</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">My travel bookings</h1>
      </div>
      <Alert><AlertDescription>A wallet debit is not a confirmed ticket. Only provider-confirmed bookings are shown as confirmed. Refunds are never marked complete without provider confirmation.</AlertDescription></Alert>
      {(bookings.data?.items ?? []).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No bookings yet. <Button asChild size="sm" variant="link"><a href="/travel/search">Search travel options</a></Button></CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {bookings.data?.items.map((booking) => (
            <Card key={booking.id}>
              <CardHeader>
                <CardTitle className="text-base">{booking.category}</CardTitle>
                <p className="text-xs text-muted-foreground">{booking.providerName} · {booking.reference}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{booking.notice}</p>
                <p>Amount: {formatMoney(booking.amountMinor, booking.currency)}</p>
                <p>Payment ref: {booking.paymentRef ?? "—"}</p>
                <p>Provider ref: {booking.providerRef ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Passengers: {booking.passengerCount}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
