"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState, StatusPill } from "@/components/control/ui";

interface Row {
  id: string; name: string; type: string; status: string; budgetMinor: number;
  consumedMinor: number; reservedMinor: number; rejectionReason: string | null; createdAt: string;
  merchantId: string | null; budget: { allocatedMinor: number; reservedMinor: number; consumedMinor: number } | null;
}

export default function ControlCampaignsPage() {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const campaigns = useQuery({ queryKey: ["control", "rewards", "campaigns"], queryFn: () => apiFetch<{ items: Row[] }>("/api/control/rewards/campaigns") });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["control", "rewards", "campaigns"] });
  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/control/rewards/campaigns/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidate(); toast.success("Campaign approved"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Approval failed"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/control/rewards/campaigns/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidate(); toast.success("Campaign rejected"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Rejection failed"),
  });
  const pause = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/control/rewards/campaigns/${encodeURIComponent(id)}/pause`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidate(); toast.success("Campaign status updated"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Update failed"),
  });

  return (
    <div>
      <ControlPageHeader eyebrow="Rewards" title="Campaign approval queue" description="Approvals, rejections and pauses are permission-checked and audited." />
      <div className="mb-4"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for decision" aria-label="Reason" className="h-9 w-80" /></div>
      {campaigns.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Campaigns</CardTitle></CardHeader>
        <CardContent>
          {(campaigns.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-slate-500">No campaigns found.</p> : (
            <div className="divide-y divide-slate-100">
              {campaigns.data?.items.map((campaign) => (
                <div key={campaign.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-900">{campaign.name} <span className="text-slate-400">· {campaign.type.replaceAll("_", " ")}</span></p>
                    <p className="text-[10px] text-slate-500">{formatDateTime(campaign.createdAt)} · budget {formatMoney(campaign.budgetMinor, "INR")} · consumed {formatMoney(campaign.consumedMinor, "INR")}</p>
                  </div>
                  <StatusPill state={campaign.status} tone={campaign.status === "ACTIVE" ? "healthy" : ["REJECTED", "EXHAUSTED"].includes(campaign.status) ? "critical" : "warning"} />
                  {campaign.status === "PENDING_APPROVAL" ? (
                    <>
                      <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(campaign.id)}>Approve</Button>
                      <Button size="sm" variant="ghost" disabled={reject.isPending || reason.length < 5} onClick={() => reject.mutate(campaign.id)}>Reject</Button>
                    </>
                  ) : null}
                  {["ACTIVE", "APPROVED", "SCHEDULED", "PAUSED"].includes(campaign.status) ? (
                    <Button size="sm" variant="outline" disabled={pause.isPending} onClick={() => pause.mutate(campaign.id)}>{campaign.status === "PAUSED" ? "Resume" : "Pause"}</Button>
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
