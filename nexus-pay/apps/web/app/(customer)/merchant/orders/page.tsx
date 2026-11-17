"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { MerchantOrderView } from "@nexus/shared-types";
import { formatMoney, formatDateTime } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const orders = useQuery({ queryKey: ["merchant", "orders"], queryFn: () => apiFetch<{ items: MerchantOrderView[] }>("/api/merchant/orders") });
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const unit = Math.round(Number(price) * 100);
      if (!Number.isSafeInteger(unit) || unit <= 0) throw new Error("Enter a valid item price.");
      return apiFetch("/api/merchant/orders", {
        method: "POST",
        body: JSON.stringify({ title, items: [{ title: itemTitle, quantity: Number(qty), unitPriceMinor: unit }] }),
      });
    },
    onSuccess: () => { setShow(false); setTitle(""); setItemTitle(""); setPrice(""); void queryClient.invalidateQueries({ queryKey: ["merchant", "orders"] }); toast.success("Order created"); },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not create order."),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Commerce</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Orders</h1></div>
        <Button onClick={() => setShow((v) => !v)}>New order</Button>
      </div>
      {show ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="order-title">Order title</Label><Input id="order-title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="item-title">Item</Label><Input id="item-title" value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="qty">Quantity</Label><Input id="qty" type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="price">Unit price (INR)</Label><Input id="price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="mt-1.5" /></div>
            </div>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <Button disabled={!title || !itemTitle || create.isPending} onClick={() => create.mutate()}>Create order</Button>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-base">All orders</CardTitle></CardHeader>
        <CardContent>
          {(orders.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No orders yet.</p> : (
            <div className="divide-y divide-border/70">
              {orders.data?.items.map((order) => (
                <div key={order.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{order.title}</p><p className="text-[10px] text-muted-foreground">{formatDateTime(order.createdAt)} · {order.status}</p></div>
                  <p className="text-sm font-semibold">{formatMoney(order.totalMinor, order.currency)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

