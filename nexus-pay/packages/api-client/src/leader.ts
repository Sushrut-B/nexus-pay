import { RaftlineConfigurationError } from "./config";
import { RaftlineError } from "./errors";
import type { HttpTransport } from "./http";

export interface ClusterStatus {
  nodeId: string;
  role: "FOLLOWER" | "PRE_CANDIDATE" | "CANDIDATE" | "LEADER" | string;
  term: number;
  leaderId: string | null;
  commitIndex: number;
  lastApplied: number;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface LeaderLocation {
  baseUrl: string;
  nodeId: string;
  term: number;
}

export class LeaderLocator {
  private cache: { location: LeaderLocation; expiresAt: number } | null = null;
  private inFlight: Promise<LeaderLocation> | null = null;

  constructor(
    private readonly baseUrls: string[],
    private readonly http: HttpTransport,
    private readonly cacheTtlMs: number,
  ) {
    if (baseUrls.length === 0) {
      throw new RaftlineConfigurationError("At least one Raftline base URL is required");
    }
  }

  invalidate(): void {
    this.cache = null;
  }

  getCached(): LeaderLocation | null {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.location;
    }
    return null;
  }

  async locate(force = false): Promise<LeaderLocation> {
    if (!force) {
      const cached = this.getCached();
      if (cached) return cached;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.discover().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  async statuses(): Promise<Array<{ baseUrl: string; status: ClusterStatus }>> {
    const results = await Promise.allSettled(
      this.baseUrls.map(async (baseUrl) => {
        const response = await this.http.request(`${baseUrl}/v1/cluster/status`, {}, 3000);
        if (response.status !== 200) {
          throw new RaftlineError(`Node ${baseUrl} returned HTTP ${response.status}`, {
            code: "UNAVAILABLE",
            status: response.status,
          });
        }
        return { baseUrl, status: parseClusterStatus(response.text) };
      }),
    );

    return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }

  private async discover(): Promise<LeaderLocation> {
    const statuses = await this.statuses();
    if (statuses.length === 0) {
      throw new RaftlineError("No Raftline nodes are reachable", { code: "UNAVAILABLE" });
    }

    const directLeader = statuses.find((entry) => entry.status.role === "LEADER");
    if (directLeader) {
      return this.remember(directLeader.baseUrl, directLeader.status);
    }

    const leaderId = statuses.find((entry) => entry.status.leaderId)?.status.leaderId ?? null;
    if (leaderId) {
      const leaderNode = statuses.find((entry) => entry.status.nodeId === leaderId);
      if (leaderNode) {
        return this.remember(leaderNode.baseUrl, leaderNode.status);
      }
    }

    throw new RaftlineError("Raftline has no elected leader", { code: "UNAVAILABLE" });
  }

  private remember(baseUrl: string, status: ClusterStatus): LeaderLocation {
    const location: LeaderLocation = {
      baseUrl,
      nodeId: status.nodeId,
      term: status.term,
    };
    this.cache = {
      location,
      expiresAt: Date.now() + this.cacheTtlMs,
    };
    return location;
  }
}

function parseClusterStatus(raw: string): ClusterStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RaftlineError("Raftline returned an invalid cluster status response", {
      code: "BAD_RESPONSE",
    });
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).nodeId !== "string" ||
    typeof (parsed as Record<string, unknown>).role !== "string"
  ) {
    throw new RaftlineError("Raftline cluster status response is missing node identity", {
      code: "BAD_RESPONSE",
    });
  }

  const value = parsed as Record<string, unknown>;
  return {
    nodeId: value.nodeId as string,
    role: value.role as string,
    term: typeof value.term === "number" ? value.term : 0,
    leaderId: typeof value.leaderId === "string" ? value.leaderId : null,
    commitIndex: typeof value.commitIndex === "number" ? value.commitIndex : 0,
    lastApplied: typeof value.lastApplied === "number" ? value.lastApplied : 0,
    lastLogIndex: typeof value.lastLogIndex === "number" ? value.lastLogIndex : 0,
    lastLogTerm: typeof value.lastLogTerm === "number" ? value.lastLogTerm : 0,
  };
}
