"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { FraudReportView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

const CATEGORIES = ["UNAUTHORIZED_TRANSACTION", "SUSPICIOUS_LOGIN", "ACCOUNT_COMPROMISE", "IMPERSONATION", "SUSPICIOUS_PAYMENT_REQUEST", "MERCHANT_DISPUTE", "SUSPECTED_SCAM"];

export default function SecurityReportsPage() {
  const queryClient = useQueryClient();
  const reports = useQuery({ queryKey: ["security", "reports"], queryFn: () => apiFetch<{ items: FraudReportView[] }>("/api/security/reports") });
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [description, setDescription] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const create = useMutation({
    mutationFn: () => apiFetch("/api/security/reports", {
      method: "POST",
      body: JSON.stringify({ category, description, ...(transactionRef ? { transactionRef } : {}) }),
    }),
    onSuccess: () => {
      setDescription(""); setTransactionRef("");
      void queryClient.invalidateQueries({ queryKey: ["security", "reports"] });
      toast.success("Report recorded for investigation");
    },
    onError: () => toast.error("Could not submit the report"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Reports</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Report suspicious activity</h1>
      </div>
      <Alert><AlertDescription>A fraud report records your concern for investigation. It does not reverse a payment or change its settled status.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">New report</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="category">Category</Label>
            <select id="category" value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1.5 h-10 w-full max-w-md rounded-lg border border-input bg-background px-3 text-sm">
              {CATEGORIES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="transaction">Transaction reference (optional)</Label>
            <Input id="transaction" value={transactionRef} onChange={(event) => setTransactionRef(event.target.value)} className="mt-1.5 max-w-md" />
          </div>
          <div>
            <Label htmlFor="description">What happened?</Label>
            <textarea id="description" value={description} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(event.target.value)} rows={4} className="mt-1.5 w-full max-w-2xl rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <Button disabled={description.length < 10 || create.isPending} onClick={() => create.mutate()}>Submit report</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Your reports</CardTitle></CardHeader>
        <CardContent>
          {(reports.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No reports yet.</p> : (
            <div className="divide-y divide-border/70">
              {reports.data?.items.map((report) => (
                <div key={report.id} className="flex justify-between py-3 text-sm">
                  <span>{report.category.replaceAll("_", " ")}</span>
                  <span className="text-xs text-muted-foreground">{report.status} · {new Date(report.createdAt).toLocaleDateString("en-IN")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
