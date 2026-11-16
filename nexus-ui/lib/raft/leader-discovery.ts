// ==============================================================================
// Nexus Clearing — Dynamic Raft Leader Discovery & Node Health Inspector
// Automatically locates the active leader node across 8001..8005 and tracks quorum.
// ==============================================================================

import { ClusterNodeStatus } from "./types";
import { QuorumUnavailableError } from "./errors";

const DEFAULT_NODES = [
  "http://127.0.0.1:8001",
  "http://127.0.0.1:8002",
  "http://127.0.0.1:8003",
  "http://127.0.0.1:8004",
  "http://127.0.0.1:8005",
];

const NODE_ID_PORT_MAP: Record<string, number> = {
  "node-1": 8001,
  "node-2": 8002,
  "node-3": 8003,
  "node-4": 8004,
  "node-5": 8005,
};

function getNodeUrls(): string[] {
  const envNodes = process.env.RAFTLINE_NODES;
  if (envNodes && envNodes.trim().length > 0) {
    return envNodes.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_NODES;
}

export function nodeIdToUrl(nodeId: string): string {
  const port = NODE_ID_PORT_MAP[nodeId];
  if (port) {
    return `http://127.0.0.1:${port}`;
  }
  return "http://127.0.0.1:8003";
}

interface CachedLeader {
  leaderUrl: string;
  leaderId: string;
  term: number;
  timestamp: number;
}

let cachedLeader: CachedLeader | null = null;
const CACHE_TTL_MS = 2000;

export function invalidateLeaderCache(): void {
  cachedLeader = null;
}

export function setLeaderHint(leaderHint: string): string | null {
  if (!leaderHint) return null;
  const url = nodeIdToUrl(leaderHint);
  cachedLeader = {
    leaderUrl: url,
    leaderId: leaderHint,
    term: cachedLeader ? cachedLeader.term : 0,
    timestamp: Date.now(),
  };
  return url;
}

/**
 * Dynamically queries all configured nodes to identify the current Raft consensus leader.
 */
export async function discoverLeader(forceRefresh = false): Promise<{
  leaderUrl: string;
  leaderId: string;
  term: number;
}> {
  const now = Date.now();
  if (!forceRefresh && cachedLeader && now - cachedLeader.timestamp < CACHE_TTL_MS) {
    return {
      leaderUrl: cachedLeader.leaderUrl,
      leaderId: cachedLeader.leaderId,
      term: cachedLeader.term,
    };
  }

  const nodes = getNodeUrls();
  const probePromises = nodes.map(async (url) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const res = await fetch(`${url}/v1/cluster/status`, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const data = (await res.json()) as ClusterNodeStatus;
      return { url, data };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(probePromises);
  const valid = results.filter((r): r is { url: string; data: ClusterNodeStatus } => r !== null);

  // 1. Look for explicit LEADER role
  const leaderEntry = valid.find((r) => r.data.role === "LEADER");
  if (leaderEntry) {
    cachedLeader = {
      leaderUrl: leaderEntry.url,
      leaderId: leaderEntry.data.nodeId,
      term: leaderEntry.data.term,
      timestamp: Date.now(),
    };
    return {
      leaderUrl: cachedLeader.leaderUrl,
      leaderId: cachedLeader.leaderId,
      term: cachedLeader.term,
    };
  }

  // 2. If no node reports LEADER directly, check if a follower has a consensus leaderId hint
  const followerWithHint = valid.find(
    (r) => r.data.leaderId && r.data.leaderId.startsWith("node-")
  );
  if (followerWithHint && followerWithHint.data.leaderId) {
    const hintUrl = nodeIdToUrl(followerWithHint.data.leaderId);
    cachedLeader = {
      leaderUrl: hintUrl,
      leaderId: followerWithHint.data.leaderId,
      term: followerWithHint.data.term,
      timestamp: Date.now(),
    };
    return {
      leaderUrl: cachedLeader.leaderUrl,
      leaderId: cachedLeader.leaderId,
      term: cachedLeader.term,
    };
  }

  // 3. Fallback to any reachable node if election is still settling
  if (valid.length > 0) {
    return {
      leaderUrl: valid[0].url,
      leaderId: valid[0].data.nodeId,
      term: valid[0].data.term,
    };
  }

  throw new QuorumUnavailableError(
    "All 5 Raftline cluster nodes are currently unreachable on ports 8001..8005"
  );
}

/**
 * Probes all 5 nodes concurrently to generate live topology & health telemetry.
 */
export async function probeAllNodes(): Promise<ClusterNodeStatus[]> {
  const nodes = getNodeUrls();

  const probes = nodes.map(async (url, idx) => {
    const nodeId = `node-${idx + 1}`;
    const httpPort = 8001 + idx;
    const grpcPort = 9001 + idx;
    const start = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      const res = await fetch(`${url}/v1/cluster/status`, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - start);

      if (res.ok) {
        const data = (await res.json()) as ClusterNodeStatus;
        return {
          ...data,
          httpPort,
          grpcPort,
          reachable: true,
          latencyMs,
        };
      }
    } catch {
      // node unreachable
    }

    return {
      nodeId,
      role: "FOLLOWER",
      term: 0,
      commitIndex: 0,
      lastApplied: 0,
      lastLogIndex: 0,
      lastLogTerm: 0,
      leaderId: null,
      httpPort,
      grpcPort,
      reachable: false,
      latencyMs: 0,
    } as ClusterNodeStatus;
  });

  return Promise.all(probes);
}

