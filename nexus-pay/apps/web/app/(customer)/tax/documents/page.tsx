"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { TaxDocumentView, TaxReconciliationView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function TaxDocumentsPage() {
  const queryClient = useQueryClient();
  const docs = useQuery({ queryKey: ["tax", "documents"], queryFn: () => apiFetch<{ items: TaxDocumentView[] }>("/api/tax/documents") });
  const recon = useQuery({ queryKey: ["tax", "recon"], queryFn: () => apiFetch<{ items: TaxReconciliationView[] }>("/api/tax/reconciliation") });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      form.set("financialYear", "2025-26");
      form.set("kind", "FORM_16");
      return apiFetch("/api/tax/documents", { method: "POST", body: form });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["tax", "documents"] }); toast.success("Document uploaded securely"); },
    onError: () => toast.error("Upload failed"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Documents</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Tax documents & reconciliation</h1>
      </div>
      <Alert><AlertDescription>Documents are encrypted and downloaded via signed short-lived links. Extracted values are never treated as verified until you confirm them. No government records are accessed.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Upload a document</CardTitle></CardHeader>
        <CardContent>
          <Input type="file" accept=".pdf,image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); }} />
          <p className="mt-2 text-xs text-muted-foreground">PDF, JPEG or PNG · up to 5 MB</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Your documents</CardTitle></CardHeader>
        <CardContent>
          {(docs.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No documents yet.</p> : (
            <div className="divide-y divide-border/70">
              {docs.data?.items.map((doc) => (
                <div key={doc.id} className="flex justify-between py-3 text-sm">
                  <span>{doc.fileName} · {doc.kind} · FY {doc.financialYear}</span>
                  <span className="text-xs text-muted-foreground">{doc.status} · {doc.extractedFields} extracted fields</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Reconciliation queue</CardTitle></CardHeader>
        <CardContent>
          {(recon.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No statement records to reconcile.</p> : (
            <div className="divide-y divide-border/70">
              {recon.data?.items.map((row) => (
                <div key={row.id} className="flex justify-between py-3 text-sm">
                  <span>{row.category} · {row.sourceRef}</span>
                  <span className="text-xs text-muted-foreground">{row.matchLevel} · {row.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

