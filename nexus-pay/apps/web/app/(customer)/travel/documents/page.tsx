"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";

interface Doc { id: string; kind: string; fileName: string; contentType: string; sizeBytes: number; status: string; createdAt: string }

export default function TravelDocumentsPage() {
  const docs = useQuery({ queryKey: ["travel", "documents"], queryFn: () => apiFetch<{ items: Doc[] }>("/api/travel/documents") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Documents</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Tickets & travel documents</h1>
      </div>
      <p className="text-xs text-muted-foreground">Documents are private and downloaded through signed, short-lived links. No document is publicly accessible.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">Your documents</CardTitle></CardHeader>
        <CardContent>
          {(docs.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No documents yet.</p> : (
            <div className="divide-y divide-border/70">
              {docs.data?.items.map((doc) => (
                <div key={doc.id} className="flex justify-between py-3 text-sm">
                  <span>{doc.fileName} · {doc.kind}</span>
                  <span className="text-xs text-muted-foreground">{doc.status} · {new Date(doc.createdAt).toLocaleDateString("en-IN")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
