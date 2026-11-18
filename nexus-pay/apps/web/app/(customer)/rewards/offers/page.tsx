"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { OfferSummary } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function OffersPage() {
  const offers = useQuery({ queryKey: ["rewards", "offers"], queryFn: () => apiFetch<{ items: OfferSummary[] }>("/api/rewards/offers") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Discover</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Offers marketplace</h1>
      </div>
      <Input placeholder="Search offers" aria-label="Search offers" className="h-9 w-72" />
      {(offers.data?.items ?? []).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No active offers right now.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {offers.data?.items.map((offer) => (
            <Card key={offer.id}>
              <CardHeader>
                <CardTitle className="text-base">{offer.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{offer.typeLabel}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="line-clamp-2 text-xs text-muted-foreground">{offer.description}</p>
                {offer.cashbackBps > 0 ? <p className="text-sm font-semibold">{(offer.cashbackBps / 100).toFixed(0)}% cashback</p> : null}
                {offer.pointsPerMinor > 0 ? <p className="text-sm font-semibold">{offer.pointsPerMinor} points per ₹100</p> : null}
                <p className="text-[11px] text-muted-foreground">Min spend {formatMoney(offer.minSpendMinor, "INR")} · max reward {formatMoney(offer.maxRewardMinor, "INR")}</p>
                <p className={`text-[11px] font-medium ${offer.eligible ? "text-emerald-700" : "text-amber-700"}`}>{offer.eligible ? "You are eligible" : offer.eligibilityReason}</p>
                {offer.promoCode ? <p className="font-mono text-xs">Code: {offer.promoCode}</p> : null}
                <Button asChild size="sm" variant="outline"><Link href={`/rewards/offers/${encodeURIComponent(offer.id)}`}>Details</Link></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
