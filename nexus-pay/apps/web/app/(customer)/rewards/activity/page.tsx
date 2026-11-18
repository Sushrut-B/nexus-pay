"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

interface Row {
  id: string; type: string; description: string; points: number | null;
  amountMinor: number | null; currency: string | null; merchantName: string | null;
  transactionRef: string | null; status: string; expiresAt: string | null; createdAt: string;
}

export default function RewardsActivityPage() {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const rows = useQuery({
    queryKey: ["rewards", "activity", type, status],
    queryFn: () => apiFetch<{ items: Row[]; total: number }>(
      `/api/rewards/activity?pageSize=50${type ? `&type=${type}` : ""}${status ? `&status=${status}` : ""}`,
    ),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">History</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Rewards activity</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Filter by event type" aria-label="Event type" className="h-9 w-64" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          <option value="">All statuses</option>
          {["COMPLETED", "PENDING", "CREDITED", "FAILED", "DEBITED", "BLOCKED_INSUFFICIENT_BALANCE"].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">{rows.data?.total ?? 0} events</CardTitle></CardHeader>
        <CardContent>
          {(rows.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No reward activity yet.</p> : (
            <div className="divide-y divide-border/70">
              {rows.data?.items.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.description}</p>
                    <p className="text-[10px] text-muted-foreground">{row.type.replaceAll("_", " ")} · {formatDateTime(row.createdAt)} · {row.status}</p>
                  </div>
                  {row.points !== null ? <p className="text-sm font-semibold">{row.points > 0 ? "+" : ""}{row.points} pts</p> : null}
                  {row.amountMinor !== null ? <p className="text-sm font-semibold">{(row.amountMinor / 100).toFixed(2)} {row.currency ?? "INR"}</p> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
