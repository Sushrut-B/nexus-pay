"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import { ControlPageHeader, LoadingState, StatusPill } from "@/components/control/ui";

interface RefundRow {
  id: string; merchantName: string; paymentRef: string; amountMinor: number;
  reason: string; status: string; createdAt: string;
}

export default function ControlMerchantRefundsPage() {
  const queryClient = useQueryClient();
  const refunds = useQuery({ queryKey: ["control", "merchant-refunds"], queryFn: () => apiFetch<{ items: RefundRow[] }>("/api/control/merchant-refunds") });
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "APPROVE" | "REJECT" }) =>
      apiFetch(`/api/control/merchant-refunds/${encodeURIComponent(id)}/review`, {
        method: "POST", body: JSON.stringify({ decision, note }),
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "merchant-refunds"] }); toast.success("Refund reviewed"); },
    onError: (failure) => toast.error(failure instanceof ApiClientError ? failure.message : "Could not review refund."),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Merchant refunds" description="Raftline has no reversal capability. Review records outcomes only; no money is moved." />
      <div className="mb-4"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note" aria-label="Review note" className="h-9 w-80" /></div>
      {refunds.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Requests</CardTitle></CardHeader>
        <CardContent>
          {(refunds.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-slate-500">No refund requests.</p> : (
            <div className="divide-y divide-slate-100">
              {refunds.data?.items.map((refund) => (
                <div key={refund.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{refund.merchantName} · {formatMoney(refund.amountMinor, "INR")}</p>
                    <p className="text-[10px] text-slate-500">{refund.paymentRef} · {refund.reason} · {formatDateTime(refund.createdAt)}</p>
                  </div>
                  <StatusPill state={refund.status} tone={refund.status === "REJECTED" ? "critical" : "warning"} />
                  {["REQUESTED", "UNDER_REVIEW"].includes(refund.status) ? (
                    <>
                      <Button size="sm" disabled={review.isPending || note.length < 5} onClick={() => review.mutate({ id: refund.id, decision: "APPROVE" })}>Approve</Button>
                      <Button size="sm" variant="ghost" disabled={review.isPending || note.length < 5} onClick={() => review.mutate({ id: refund.id, decision: "REJECT" })}>Reject</Button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
