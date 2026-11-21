"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { HelpArticleView } from "@nexus/shared-types";
import { SupportHeader, SupportNav, SupportNotice } from "@/components/support/support-ui";

export default function HelpCentrePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const query = useQuery({
    queryKey: ["support", "articles", search, category],
    queryFn: () => apiFetch<{ categories: Array<{ code: string; label: string }>; articles: HelpArticleView[] }>(`/api/support/articles?search=${encodeURIComponent(search)}${category ? `&category=${category}` : ""}`),
  });
  const feedback = useMutation({
    mutationFn: ({ id, helpful }: { id: string; helpful: boolean }) => apiFetch(`/api/support/articles/${id}/feedback`, { method: "POST", body: JSON.stringify({ helpful }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["support", "articles"] }),
  });
  return (
    <div className="space-y-6">
      <SupportHeader eyebrow="Support Centre" title="Help Centre" description="Guidance for implemented Nexus Pay features only. Articles are versioned and reviewed." />
      <SupportNav />
      <SupportNotice>Help articles are general guidance, not provider-specific promises or refund timelines.</SupportNotice>
      <div className="flex flex-wrap gap-2">
        <Input className="w-64" placeholder="Search articles" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Input className="w-56" placeholder="Category code" value={category} onChange={(e) => setCategory(e.target.value.toUpperCase())} />
      </div>
      <div className="flex flex-wrap gap-2">
        {query.data?.categories.map((c) => <Button key={c.code} size="sm" variant={category === c.code ? "default" : "outline"} onClick={() => setCategory(c.code)}>{c.label}</Button>)}
      </div>
      {(query.data?.articles ?? []).length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No published articles match your search.</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {query.data?.articles.map((article) => (
            <Card key={article.id}>
              <CardHeader><CardTitle className="text-base">{article.title}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap text-sm">{article.body}</p>
                <p className="text-[11px] text-muted-foreground">Version {article.version} Â· Last reviewed {new Date(article.lastReviewedAt).toLocaleDateString("en-IN")}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => feedback.mutate({ id: article.id, helpful: true })}>Helpful</Button>
                  <Button size="sm" variant="outline" onClick={() => feedback.mutate({ id: article.id, helpful: false })}>Not helpful</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
