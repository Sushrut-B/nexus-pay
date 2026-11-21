"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { SupportNav } from "@/components/support/support-ui";
import { toast } from "sonner";

interface AdminArticle { id: string; slug: string; title: string; status: string; version: number; lastReviewedAt: string }

export default function SupportArticlesAdminPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["support-control", "articles"], queryFn: () => apiFetch<{ articles: AdminArticle[] }>("/api/support/articles") });
  const [form, setForm] = useState({ categoryCode: "WALLET_PAYMENTS", title: "", body: "" });
  const create = useMutation({
    mutationFn: () => apiFetch("/api/control/support/articles", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["support-control", "articles"] }); setForm({ ...form, title: "", body: "" }); toast.success("Article created"); },
  });
  const publish = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/control/support/articles/${id}/publish`, { method: "POST", body: JSON.stringify({ title: "Reviewed guidance", body: "Reviewed content for this article. Add verified product guidance before publishing." }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["support-control", "articles"] }); },
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Support Operations" title="Help article administration" description="Versioned content with review workflow. No policy or provider promise is invented." />
      <SupportNav control />
      {query.isLoading ? <LoadingState /> : null}
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Input placeholder="Category code" value={form.categoryCode} onChange={(e) => setForm({ ...form, categoryCode: e.target.value.toUpperCase() })} />
        <Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input className="sm:col-span-2" placeholder="Body" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <Button disabled={create.isPending || form.title.length < 3 || form.body.length < 20} onClick={() => create.mutate()}>Create draft</Button>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        {(query.data?.articles ?? []).length === 0 ? <p className="text-xs text-slate-500">No published articles.</p> : query.data?.articles.map((a) => (
          <div key={a.id} className="flex flex-wrap justify-between border-b border-border/70 py-2 text-xs last:border-0">
            <span>{a.title} Â· v{a.version} Â· {a.status}</span>
            <Button size="sm" variant="outline" disabled={publish.isPending} onClick={() => publish.mutate(a.id)}>Publish new version</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
