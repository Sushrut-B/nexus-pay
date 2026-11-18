"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { ApplicationView, DocumentView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export function ApplicationTracker({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const application = useQuery({ queryKey: ["credit", "application", id], queryFn: () => apiFetch<ApplicationView>(`/api/credit/applications/${encodeURIComponent(id)}`) });
  const documents = useQuery({ queryKey: ["credit", "documents", id], queryFn: () => apiFetch<{ items: DocumentView[] }>(`/api/credit/applications/${encodeURIComponent(id)}/documents`) });
  const [category, setCategory] = useState("IDENTITY");
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["credit"] });
  const submit = useMutation({
    mutationFn: () => apiFetch(`/api/credit/applications/${encodeURIComponent(id)}/submit`, { method: "POST", body: "{}" }),
    onSuccess: () => { invalidate(); toast.success("Application submitted — not an approval"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Submission failed"),
  });
  const withdraw = useMutation({
    mutationFn: () => apiFetch(`/api/credit/applications/${encodeURIComponent(id)}/withdraw`, { method: "POST", body: "{}" }),
    onSuccess: () => { invalidate(); toast.success("Application withdrawn"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Withdrawal failed"),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("category", category);
      form.set("file", file);
      return apiFetch(`/api/credit/applications/${encodeURIComponent(id)}/documents`, { method: "POST", body: form });
    },
    onSuccess: () => { invalidate(); toast.success("Document encrypted and stored"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Upload failed"),
  });
  const data = application.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Application tracker</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.providerName ?? "Application"}</h1>
      </div>
      {data ? (
        <>
          <Alert><AlertDescription>Status: {data.status.replaceAll("_", " ")}. Submission is not approval and approval is not disbursement.</AlertDescription></Alert>
          <Card>
            <CardHeader><CardTitle className="text-base">Status history</CardTitle></CardHeader>
            <CardContent>
              {data.history.map((item, index) => (
                <div key={`${item.at}-${index}`} className="flex justify-between py-2 text-xs">
                  <span>{item.from ?? "—"} → {item.to}</span><span className="text-muted-foreground">{formatDateTime(item.at)} · {item.actor}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Documents</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Document category" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
                  {["IDENTITY", "ADDRESS", "INCOME", "EMPLOYMENT", "BANK_STATEMENT", "BUSINESS", "OTHER"].map((value) => <option key={value}>{value}</option>)}
                </select>
                <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.csv" aria-label="Document file" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); }} />
              </div>
              {(documents.data?.items ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No documents uploaded.</p> : (
                <div className="divide-y divide-border/70">
                  {documents.data?.items.map((doc) => (
                    <div key={doc.id} className="flex justify-between py-2 text-xs"><span>{doc.category} · {doc.fileName}</span><span>{doc.status}</span></div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <div className="flex gap-2">
            {["DRAFT", "READY_FOR_SUBMISSION"].includes(data.status) ? <Button disabled={submit.isPending} onClick={() => submit.mutate()}>Submit application</Button> : null}
            {["DRAFT", "READY_FOR_SUBMISSION", "UNDER_REVIEW", "ADDITIONAL_INFORMATION_REQUIRED"].includes(data.status) ? <Button variant="ghost" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw</Button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
