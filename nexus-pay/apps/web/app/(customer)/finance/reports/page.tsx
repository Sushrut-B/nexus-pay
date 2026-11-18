"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Label } from "@nexus/ui";
import type { FinancialReportView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

const TYPES = ["MONTHLY_SUMMARY", "ANNUAL_SUMMARY", "CATEGORY_EXPENDITURE", "MERCHANT_EXPENDITURE", "SUBSCRIPTION", "RECURRING_PAYMENT", "BUDGET_PERFORMANCE", "SAVINGS_GOAL"];

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const reports = useQuery({ queryKey: ["finance", "reports"], queryFn: () => apiFetch<{ items: FinancialReportView[] }>("/api/finance/reports") });
  const [type, setType] = useState("MONTHLY_SUMMARY");
  const [format, setFormat] = useState("PDF");
  const create = useMutation({
    mutationFn: () => apiFetch("/api/finance/reports", { method: "POST", body: JSON.stringify({ type, format, period: "month" }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["finance", "reports"] }); toast.success("Report queued"); },
    onError: () => toast.error("Could not queue report"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Reports</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Financial reports</h1>
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-5">
          <div><Label htmlFor="report-type">Report</Label><select id="report-type" value={type} onChange={(e) => setType(e.target.value)} className="mt-1.5 h-10 rounded-lg border border-input bg-background px-3 text-sm">{TYPES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
          <div><Label htmlFor="report-format">Format</Label><select id="report-format" value={format} onChange={(e) => setFormat(e.target.value)} className="mt-1.5 h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="PDF">PDF</option><option value="CSV">CSV</option></select></div>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>Generate report</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Your reports</CardTitle></CardHeader>
        <CardContent>
          {(reports.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No reports generated yet.</p> : (
            <div className="divide-y divide-border/70">
              {reports.data?.items.map((report) => (
                <div key={report.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{report.type.replaceAll("_", " ")} · {report.format}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDateTime(report.createdAt)} · {report.status}</p>
                  </div>
                  {report.status === "READY" ? <Button size="sm" variant="outline" asChild><a href={`/api/finance/reports/${encodeURIComponent(report.id)}/download`}>Download</a></Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
