"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { RewardCatalogueView } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function CataloguePage() {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ["rewards", "catalogue"], queryFn: () => apiFetch<{ items: RewardCatalogueView[] }>("/api/rewards/catalogue") });
  const [voucher, setVoucher] = useState<string | null>(null);
  const redeem = useMutation({
    mutationFn: (item: RewardCatalogueView) => apiFetch<{ voucherToken: string; voucherCodeHint: string }>("/api/rewards/catalogue", {
      method: "POST",
      body: JSON.stringify({ catalogueItemId: item.id, idempotencyKey: crypto.randomUUID() }),
    }),
    onSuccess: (result) => {
      setVoucher(result.voucherToken);
      void queryClient.invalidateQueries({ queryKey: ["rewards", "catalogue"] });
      void queryClient.invalidateQueries({ queryKey: ["rewards", "summary"] });
      toast.success("Reward redeemed");
    },
    onError: (error) => toast.error(error instanceof ApiClientError || error instanceof Error ? error.message : "Could not redeem"),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Redeem</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Rewards catalogue</h1>
      </div>
      {voucher ? <Alert><AlertDescription className="break-all">Your voucher token (shown once): <strong>{voucher}</strong></AlertDescription></Alert> : null}
      {(items.data?.items ?? []).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No rewards available yet.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.data?.items.map((item) => (
            <Card key={item.id}>
              <CardHeader><CardTitle className="text-base">{item.name}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{item.description}</p>
                <p className="text-sm font-semibold">{item.pointsCost.toLocaleString("en-IN")} points</p>
                {item.remaining !== null ? <p className="text-[11px] text-muted-foreground">{item.remaining} remaining</p> : null}
                {item.terms ? <p className="text-[11px] text-muted-foreground">{item.terms}</p> : null}
                <Button size="sm" disabled={!item.active || item.remaining === 0 || redeem.isPending} onClick={() => redeem.mutate(item)}>Redeem</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
