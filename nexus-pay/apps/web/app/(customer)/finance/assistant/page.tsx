"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { AssistantResult } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { ASSISTANT_SUGGESTIONS } from "@/lib/finance-intelligence/assistant-service-client";

export default function AssistantPage() {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chat = useMutation({
    mutationFn: () => apiFetch<AssistantResult>("/api/finance/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversationId: result?.conversationId }),
    }),
    onSuccess: (value) => { setResult(value); setMessage(""); setError(null); },
    onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Could not answer that question"),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Nexus Finance Assistant</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Ask about your money</h1>
      </div>
      <Alert><AlertDescription>Answers come only from your own persisted records. This assistant does not provide investment, tax or loan advice.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Suggested questions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {ASSISTANT_SUGGESTIONS.map((suggestion) => (
            <Button key={suggestion} size="sm" variant="outline" onClick={() => { setMessage(suggestion); }}>{suggestion}</Button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex gap-2">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask a question about your finances" aria-label="Question" />
            <Button disabled={message.length < 3 || chat.isPending} onClick={() => chat.mutate()}>Ask</Button>
          </div>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {result ? (
            <div className="rounded-xl border border-border bg-secondary/30 p-4">
              <p className="text-sm font-medium">{result.answer}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">Source: {result.dataSource.toLowerCase()} · Mode: deterministic{result.period ? ` · ${result.period}` : ""}</p>
              {result.calculation ? <p className="mt-1 text-[11px] text-muted-foreground">Calculation: {result.calculation}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {result.links.map((link) => <Button key={link} asChild size="sm" variant="ghost"><Link href={link}>{link}</Link></Button>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {result.suggestedFollowUps.map((followUp) => <Button key={followUp} size="sm" variant="ghost" onClick={() => setMessage(followUp)}>{followUp}</Button>)}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
