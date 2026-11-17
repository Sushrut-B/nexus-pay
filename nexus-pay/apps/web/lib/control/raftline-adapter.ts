import { createRaftlineClient, loadRaftlineConfig } from "@nexus/api-client";
import { getServerEnv } from "@/lib/env";
import type { ChaosScenario } from "@nexus/shared-types";

export interface NodeProbe {
  nodeId: string;
  httpUrl: string;
  grpcPort: number;
  reachable: boolean;
  role: string | null;
  term: number | null;
  leaderId: string | null;
  commitIndex: number | null;
  lastApplied: number | null;
  lastLogIndex: number | null;
  lastLogTerm: number | null;
  responseTimeMs: number;
  observedAt: string;
  error: string | null;
}

export interface ChaosStatusResponse {
  nodeId: string;
  role: string;
  isPaused: boolean;
  isolatedPeers: string[];
  peerDelaysMs: Record<string, number>;
  peerDropRates: Record<string, number>;
  recentEvents: Array<{
    id: string;
    timestamp: string;
    scenario: string;
    target: string;
    details: string;
    active: boolean;
  }>;
}

function controlConfig() {
  const env = getServerEnv();
  const config = loadRaftlineConfig(env as unknown as Record<string, string | undefined>);
  const urls = config.baseUrls.length >= 5
    ? config.baseUrls.slice(0, 5)
    : [1, 2, 3, 4, 5].map((index) => `http://localhost:800${index}`);
  return {
    nodes: urls.map((httpUrl, index) => ({
      nodeId: `node-${index + 1}`,
      httpUrl,
      grpcPort: 9001 + index,
    })),
    apiKey: config.apiKey,
    timeoutMs: Math.min(config.timeoutMs, 8000),
  };
}

function headers(apiKey: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (apiKey) {
    result.Authorization = `Bearer ${apiKey}`;
    result["X-API-Key"] = apiKey;
  }
  return result;
}

async function requestJson<T>(
  url: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null; responseMs: number }> {
  const started = Date.now();
  const { apiKey, timeoutMs } = controlConfig();
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        ...headers(apiKey),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
      cache: "no-store",
    });
    const text = await response.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : (data as { error?: string } | null)?.error ?? `HTTP ${response.status}`,
      responseMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : "Request failed",
      responseMs: Date.now() - started,
    };
  }
}

export function configuredNodes() {
  return controlConfig().nodes;
}

export async function probeNode(node: { nodeId: string; httpUrl: string; grpcPort: number }): Promise<NodeProbe> {
  const result = await requestJson<Record<string, unknown>>(`${node.httpUrl}/v1/cluster/status`);
  const data = result.data;
  const num = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  return {
    nodeId: node.nodeId,
    httpUrl: node.httpUrl,
    grpcPort: node.grpcPort,
    reachable: result.ok && data !== null,
    role: typeof data?.role === "string" ? data.role : null,
    term: num(data?.term),
    leaderId: typeof data?.leaderId === "string" ? data.leaderId : null,
    commitIndex: num(data?.commitIndex),
    lastApplied: num(data?.lastApplied),
    lastLogIndex: num(data?.lastLogIndex),
    lastLogTerm: num(data?.lastLogTerm),
    responseTimeMs: result.responseMs,
    observedAt: new Date().toISOString(),
    error: result.error,
  };
}

export async function probeCluster(): Promise<NodeProbe[]> {
  return Promise.all(configuredNodes().map(probeNode));
}

export async function getChaosStatus(httpUrl: string): Promise<ChaosStatusResponse | null> {
  const result = await requestJson<ChaosStatusResponse>(`${httpUrl}/v1/chaos/status`);
  return result.ok ? result.data : null;
}

export async function getChaosVerify(httpUrl: string): Promise<Record<string, unknown> | null> {
  const result = await requestJson<Record<string, unknown>>(`${httpUrl}/v1/chaos/verify`);
  return result.ok ? result.data : null;
}

export interface ChaosResult {
  ok: boolean;
  status: number;
  response: Record<string, unknown>;
  error: string | null;
}

export async function injectChaos(
  httpUrl: string,
  scenario: ChaosScenario,
  body: { target?: string; peer?: string; delayMs?: number; dropRate?: number },
): Promise<ChaosResult> {
  const result = await requestJson<Record<string, unknown>>(`${httpUrl}/v1/chaos/inject`, {
    method: "POST",
    body: { scenario, ...body },
  });
  return {
    ok: result.ok,
    status: result.status,
    response: result.data ?? {},
    error: result.error,
  };
}

export async function healChaos(
  httpUrl: string,
  query: { peer?: string; all?: boolean },
): Promise<ChaosResult> {
  const params = new URLSearchParams();
  if (query.peer && !query.all) params.set("peer", query.peer);
  else params.set("all", "true");
  const result = await requestJson<Record<string, unknown>>(`${httpUrl}/v1/chaos/heal?${params}`, {
    method: "POST",
  });
  return {
    ok: result.ok,
    status: result.status,
    response: result.data ?? {},
    error: result.error,
  };
}

export function getRaftlineReceipt(ref: string) {
  const client = createRaftlineClient();
  return client.getTransaction(ref);
}
