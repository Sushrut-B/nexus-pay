"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { MerchantView } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState, StatusPill } from "@/components/control/ui";

export default function ControlMerchantsPage() {
  const queryClient = useQueryClient();
  const merchants = useQuery({ queryKey: ["control", "merchants"], queryFn: () => apiFetch<{ items: MerchantView[] }>("/api/control/merchants") });
  const [filter, setFilter] = useState("");
  const [reason, setReason] = useState("");

  const status = useMutation({
    mutationFn: ({ id, target }: { id: string; target: string }) =>
      apiFetch(`/api/control/merchants/${encodeURIComponent(id)}/status`, {
        method: "POST",
        body: JSON.stringify({ status: target, reason: reason || `Admin set ${target}` }),
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "merchants"] }); toast.success("Merchant status updated"); },
    onError: (failure) => toast.error(failure instanceof ApiClientError ? failure.message : "Could not update merchant."),
  });

  const items = (merchants.data?.items ?? []).filter((merchant) =>
    !filter || `${merchant.businessName} ${merchant.handle}`.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Merchants" description="Sandbox merchant registrations. Approval is application-level, not regulatory verification." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search merchants" aria-label="Search merchants" className="h-9 w-64" />
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for action" aria-label="Reason" className="h-9 w-64" />
      </div>
      {merchants.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Registrations</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? <p className="py-10 text-center text-xs text-slate-500">No merchants found.</p> : (
            <div className="divide-y divide-slate-100">
              {items.map((merchant) => (
                <div key={merchant.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-900">{merchant.businessName} <span className="text-slate-400">@{merchant.handle}</span></p>
                    <p className="text-[10px] text-slate-500">{formatDateTime(merchant.createdAt)} · {merchant.email}</p>
                  </div>
                  <StatusPill state={merchant.status.replaceAll("_", " ")} tone={merchant.status === "ACTIVE" ? "healthy" : merchant.status === "SUSPENDED" ? "critical" : "warning"} />
                  {merchant.status === "PENDING_REVIEW" ? <Button size="sm" disabled={status.isPending} onClick={() => status.mutate({ id: merchant.id, target: "ACTIVE" })}>Approve</Button> : null}
                  {merchant.status === "ACTIVE" ? <Button size="sm" variant="ghost" disabled={status.isPending} onClick={() => status.mutate({ id: merchant.id, target: "SUSPENDED" })}>Suspend</Button> : null}
                  {merchant.status === "SUSPENDED" ? <Button size="sm" variant="outline" disabled={status.isPending} onClick={() => status.mutate({ id: merchant.id, target: "ACTIVE" })}>Reactivate</Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
