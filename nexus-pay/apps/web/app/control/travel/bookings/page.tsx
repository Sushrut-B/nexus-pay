"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface Row { id: string; reference: string; category: string; status: string; paymentRef: string | null; providerRef: string | null }

export default function ControlTravelBookingsPage() {
  const query = useQuery({ queryKey: ["control", "travel", "bookings"], queryFn: () => apiFetch<{ items: Row[] }>("/api/control/travel/bookings") });
  return (
    <div>
      <ControlPageHeader eyebrow="Travel" title="Bookings" description="Lifecycle, wallet settlement references and provider references for investigation." />
      {query.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Booking queue</CardTitle></CardHeader>
        <CardContent>
          {(query.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No bookings.</p> : (
            <div className="divide-y divide-slate-100">
              {query.data?.items.map((row) => (
                <div key={row.id} className="flex justify-between gap-4 py-2 text-xs">
                  <span>{row.reference} · {row.category} · {row.status}</span>
                  <span className="text-slate-500">wallet {row.paymentRef ?? "—"} / provider {row.providerRef ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
