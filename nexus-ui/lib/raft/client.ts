// ==============================================================================
// Nexus Clearing — Universal Server-Side Raftline API Client
// Transparently routes requests to the active leader, handles leader failover hints,
// and strictly preserves client idempotency keys across all retries.
// ==============================================================================

import { discoverLeader, invalidateLeaderCache, setLeaderHint, nodeIdToUrl } from "./leader-discovery";
import { RaftError, NotLeaderError, QuorumUnavailableError } from "./errors";

interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
  isXml?: boolean;
}

export async function raftRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const maxRetries = 3;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    attempt++;
    let leaderUrl = "";
    let leaderId = "";

    try {
      const leader = await discoverLeader(attempt > 1);
      leaderUrl = leader.leaderUrl;
      leaderId = leader.leaderId;
    } catch (e) {
      if (attempt >= maxRetries) {
        throw new QuorumUnavailableError(
          e instanceof Error ? e.message : "Unable to discover leader node"
        );
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
      continue;
    }

    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const targetUrl = `${leaderUrl}${cleanEndpoint}`;

    try {
      const headers = new Headers(options.headers || {});
      if (!headers.has("Accept")) {
        headers.set("Accept", options.isXml ? "application/xml" : "application/json");
      }
      if (options.body && typeof options.body === "string" && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      if (options.idempotencyKey) {
        headers.set("Idempotency-Key", options.idempotencyKey);
      }

      const controller = new AbortController();
      const timeoutMs = options.method === "POST" ? 15000 : 5000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(targetUrl, {
        ...options,
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeoutId);

      // Check if node returned NotLeader redirect or error
      if (!response.ok) {
        const errorText = await response.text();
        let errorJson: { error?: string; leaderHint?: string } = {};
        try {
          errorJson = JSON.parse(errorText);
        } catch {
          // not json
        }

        const msg = errorJson.error || errorText || `HTTP ${response.status}`;

        // Check if error is NotLeaderException
        if (msg.includes("NotLeaderException") || msg.includes("not the leader")) {
          invalidateLeaderCache();
          const match = msg.match(/Leader hint:\s*(node-\d+)/i);
          if (match && match[1]) {
            setLeaderHint(match[1]);
          }
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 150 * attempt));
            continue;
          }
          throw new NotLeaderError(match ? match[1] : null);
        }

        throw new RaftError(msg, response.status, null, errorJson);
      }

      if (options.isXml) {
        const xmlText = await response.text();
        return xmlText as unknown as T;
      }

      const json = await response.json();
      return json as T;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (lastError instanceof RaftError && !(lastError instanceof NotLeaderError)) {
        // Business logic error (e.g. 400 Bad Request, 422 Insufficient Funds) — do not retry
        throw lastError;
      }

      // Connection dropped or timeout during failover: invalidate leader cache
      invalidateLeaderCache();
      if (attempt >= maxRetries) {
        break;
      }
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }

  throw (
    lastError ||
    new RaftError(`Failed to complete Raftline request after ${maxRetries} attempts`)
  );
}

