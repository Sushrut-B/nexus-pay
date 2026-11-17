"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { ApiKeyView, WebhookEndpointView } from "@nexus/shared-types";
import { WEBHOOK_EVENT_TYPES, API_SCOPES } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function DevelopersPage() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ["merchant", "keys"], queryFn: () => apiFetch<{ items: ApiKeyView[] }>("/api/merchant/api-keys") });
  const endpoints = useQuery({ queryKey: ["merchant", "webhooks"], queryFn: () => apiFetch<{ items: WebhookEndpointView[] }>("/api/merchant/webhooks") });
  const [keyName, setKeyName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["payments:read", "orders:read"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["payment.succeeded"]);

  const createKey = useMutation({
    mutationFn: () => apiFetch<ApiKeyView & { secret: string }>("/api/merchant/api-keys", { method: "POST", body: JSON.stringify({ name: keyName, scopes }) }),
    onSuccess: (result) => { setSecret(result.secret); setKeyName(""); void queryClient.invalidateQueries({ queryKey: ["merchant", "keys"] }); toast.success("Key created — copy the secret now"); },
    onError: (failure) => toast.error(failure instanceof ApiClientError ? failure.message : "Could not create key."),
  });
  const createWebhook = useMutation({
    mutationFn: () => apiFetch<WebhookEndpointView & { signingSecret: string }>("/api/merchant/webhooks", { method: "POST", body: JSON.stringify({ url, events }) }),
    onSuccess: () => { setUrl(""); void queryClient.invalidateQueries({ queryKey: ["merchant", "webhooks"] }); toast.success("Webhook endpoint added"); },
    onError: (failure) => toast.error(failure instanceof ApiClientError ? failure.message : "Could not add webhook."),
  });

  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Integrations</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Developer portal</h1></div>
      {secret ? <Alert><AlertDescription className="break-all">Copy this secret now. It will never be shown again: <strong>{secret}</strong></AlertDescription></Alert> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">API keys</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name" aria-label="Key name" />
            <div className="flex flex-wrap gap-1">
              {API_SCOPES.map((scope) => (
                <button key={scope} type="button" onClick={() => setScopes((current) => current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope])} className={`rounded-md border px-2 py-1 text-[10px] ${scopes.includes(scope) ? "border-primary bg-accent text-primary" : "border-border"}`}>{scope}</button>
              ))}
            </div>
            <Button disabled={!keyName || scopes.length === 0 || createKey.isPending} onClick={() => createKey.mutate()}>Create API key</Button>
            <div className="divide-y divide-border/70">
              {keys.data?.items.map((key) => <div key={key.id} className="py-2 text-xs"><span className="font-mono">{key.keyPrefix}…</span> · {key.name} · {key.scopes.join(", ")}</div>)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Webhook endpoints</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/nexus" aria-label="Webhook URL" />
            <select value={events[0]} onChange={(e) => setEvents([e.target.value])} aria-label="Event" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs">
              {WEBHOOK_EVENT_TYPES.map((event) => <option key={event} value={event}>{event}</option>)}
            </select>
            <Button disabled={!url || createWebhook.isPending} onClick={() => createWebhook.mutate()}>Add endpoint</Button>
            <div className="divide-y divide-border/70">
              {endpoints.data?.items.map((endpoint) => <div key={endpoint.id} className="py-2 text-xs"><span className="font-mono">{endpoint.url}</span> · {endpoint.events.join(", ")} · {endpoint.enabled ? "enabled" : "disabled"}</div>)}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


