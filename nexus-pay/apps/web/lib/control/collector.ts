import { prisma, type ClusterSnapshot, type NodeObservation } from "@nexus/database";
import type { AlertSeverity, ClusterHealth, ControlOverview, NodeView } from "@nexus/shared-types";
import {
  configuredNodes,
  getChaosStatus,
  probeCluster,
  type NodeProbe,
} from "@/lib/control/raftline-adapter";

const STALE_AFTER_MS = 90_000;

interface AlertCandidate {
  fingerprint: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  nodeId?: string | null;
  suggestedSteps?: string;
}

export function deriveClusterHealth(probes: NodeProbe[], leaderId: string | null, recovering: boolean): ClusterHealth {
  const reachable = probes.filter((probe) => probe.reachable).length;
  const quorum = Math.floor(probes.length / 2) + 1;
  if (reachable === 0) return "UNKNOWN";
  if (reachable < quorum) return "QUORUM_LOST";
  if (!leaderId) return "NO_LEADER";
  if (recovering) return "RECOVERING";
  if (reachable < probes.length) return "DEGRADED";
  return "HEALTHY";
}

function consensusValue<T extends string | number | null>(values: T[]): T {
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const key = String(value);
    const entry = counts.get(key) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value ?? (null as T);
}

function nodeHealth(probe: NodeProbe, leaderId: string | null): NodeView["health"] {
  if (!probe.reachable) return "UNAVAILABLE";
  if (!probe.role) return "UNKNOWN";
  if (probe.role.toUpperCase() === "LEADER" && probe.nodeId !== leaderId) return "DEGRADED";
  return "HEALTHY";
}

function toNodeView(observation: NodeObservation, leaderId: string | null, probe?: NodeProbe): NodeView {
  const config = configuredNodes().find((node) => node.nodeId === observation.nodeId);
  return {
    nodeId: observation.nodeId,
    httpUrl: config?.httpUrl ?? "Not available",
    grpcPort: config?.grpcPort ?? 0,
    reachable: observation.reachable,
    role: observation.role,
    term: observation.term === null ? null : Number(observation.term),
    commitIndex: observation.commitIndex === null ? null : Number(observation.commitIndex),
    lastApplied: observation.lastApplied === null ? null : Number(observation.lastApplied),
    lastLogIndex: probe?.lastLogIndex ?? null,
    responseTimeMs: observation.responseTimeMs,
    lastSuccessfulCheck: observation.reachable ? observation.observedAt.toISOString() : null,
    observedAt: observation.observedAt.toISOString(),
    error: observation.error,
    isLeader: observation.nodeId === leaderId,
    health: nodeHealth(
      {
        nodeId: observation.nodeId,
        httpUrl: config?.httpUrl ?? "",
        grpcPort: config?.grpcPort ?? 0,
        reachable: observation.reachable,
        role: observation.role,
        term: observation.term === null ? null : Number(observation.term),
        leaderId: null,
        commitIndex: observation.commitIndex === null ? null : Number(observation.commitIndex),
        lastApplied: observation.lastApplied === null ? null : Number(observation.lastApplied),
        lastLogIndex: probe?.lastLogIndex ?? null,
        lastLogTerm: null,
        responseTimeMs: observation.responseTimeMs,
        observedAt: observation.observedAt.toISOString(),
        error: observation.error,
      },
      leaderId,
    ),
  };
}

async function syncAlerts(
  candidates: AlertCandidate[],
  snapshotId: string,
): Promise<void> {
  const active = new Set(candidates.map((candidate) => candidate.fingerprint));
  const existing = await prisma.operationalAlert.findMany({
    where: { fingerprint: { in: [...active] } },
  });
  const existingByFingerprint = new Map(existing.map((alert) => [alert.fingerprint, alert]));

  for (const candidate of candidates) {
    const found = existingByFingerprint.get(candidate.fingerprint);
    if (found) {
      await prisma.operationalAlert.update({
        where: { id: found.id },
        data: {
          lastObservedAt: new Date(),
          description: candidate.description,
          severity: candidate.severity,
          status: found.status === "RESOLVED" ? "OPEN" : found.status,
          suggestedSteps: candidate.suggestedSteps ?? null,
          metadata: { snapshotId },
        },
      });
    } else {
      await prisma.operationalAlert.create({
        data: {
          fingerprint: candidate.fingerprint,
          title: candidate.title,
          description: candidate.description,
          severity: candidate.severity,
          nodeId: candidate.nodeId ?? null,
          suggestedSteps: candidate.suggestedSteps ?? null,
          metadata: { snapshotId },
        },
      });
    }
  }

  const all = await prisma.operationalAlert.findMany({ where: { status: { not: "RESOLVED" } } });
  for (const alert of all) {
    if (!active.has(alert.fingerprint)) {
      await prisma.operationalAlert.update({
        where: { id: alert.id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
    }
  }
}

function alertCandidates(health: ClusterHealth, probes: NodeProbe[], leaderId: string | null): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  if (health === "QUORUM_LOST") {
    candidates.push({
      fingerprint: "quorum-lost",
      title: "Quorum lost",
      description: "Fewer than three nodes responded; the cluster cannot commit new entries.",
      severity: "CRITICAL",
      suggestedSteps: "Check node reachability and inspect chaos state before attempting recovery.",
    });
  }
  if (!leaderId && health !== "UNKNOWN") {
    candidates.push({
      fingerprint: "no-leader",
      title: "No active leader",
      description: "No reachable node reported a current leader.",
      severity: "CRITICAL",
      suggestedSteps: "Inspect node roles and cluster status; verify an election completed.",
    });
  }
  for (const probe of probes.filter((item) => !item.reachable)) {
    candidates.push({
      fingerprint: `node-unavailable:${probe.nodeId}`,
      title: `${probe.nodeId} unavailable`,
      description: `Health probe failed: ${probe.error ?? "no response"}`,
      severity: "HIGH",
      nodeId: probe.nodeId,
      suggestedSteps: "Verify the node process and consider a heal operation if a chaos fault is active.",
    });
  }
  if (health === "DEGRADED") {
    candidates.push({
      fingerprint: "cluster-degraded",
      title: "Cluster degraded",
      description: "At least one node is unreachable but quorum remains available.",
      severity: "MEDIUM",
      suggestedSteps: "Review node details and recent leader transitions.",
    });
  }
  return candidates;
}

export async function collectClusterSnapshot(): Promise<ControlOverview> {
  const probes = await probeCluster();
  const leaderId = consensusValue<string | null>(probes.map((probe) => probe.leaderId));
  const term = consensusValue<number | null>(probes.map((probe) => probe.term));
  const commitIndex = consensusValue<number | null>(probes.map((probe) => probe.commitIndex));
  const lastApplied = consensusValue<number | null>(probes.map((probe) => probe.lastApplied));

  const previous = await prisma.clusterSnapshot.findFirst({ orderBy: { observedAt: "desc" } });
  const recentTransition = previous?.leaderId !== leaderId
    && previous !== null
    && Date.now() - previous.observedAt.getTime() < 5 * 60_000;
  const health = deriveClusterHealth(probes, leaderId, recentTransition);

  const started = Date.now();
  const snapshot = await prisma.clusterSnapshot.create({
    data: {
      leaderId,
      term: term === null ? null : BigInt(term),
      commitIndex: commitIndex === null ? null : BigInt(commitIndex),
      lastApplied: lastApplied === null ? null : BigInt(lastApplied),
      healthyNodes: probes.filter((probe) => probe.reachable).length,
      unavailableNodes: probes.filter((probe) => !probe.reachable).length,
      quorum: Math.floor(probes.length / 2) + 1,
      totalNodes: probes.length,
      health,
      capturedMs: Date.now() - started,
      nodes: {
        create: probes.map((probe) => ({
          nodeId: probe.nodeId,
          reachable: probe.reachable,
          role: probe.role,
          term: probe.term === null ? null : BigInt(probe.term),
          commitIndex: probe.commitIndex === null ? null : BigInt(probe.commitIndex),
          lastApplied: probe.lastApplied === null ? null : BigInt(probe.lastApplied),
          responseTimeMs: probe.responseTimeMs,
          error: probe.error,
          observedAt: new Date(probe.observedAt),
        })),
      },
    },
    include: { nodes: true },
  });

  // A term change with the same leader is still an election (re-election) and
  // must be visible in the monitoring timeline.
  const termChanged =
    previous?.term !== null && previous?.term !== undefined && term !== null && previous.term !== BigInt(term);
  if (previous && (previous.leaderId !== leaderId || termChanged)) {
    await prisma.leaderTransition.create({
      data: {
        fromLeaderId: previous.leaderId,
        toLeaderId: leaderId,
        term: term === null ? null : BigInt(term),
        source: "OBSERVED",
        snapshotId: snapshot.id,
      },
    });
  }

  await syncAlerts(alertCandidates(health, probes, leaderId), snapshot.id);
  return toOverview(snapshot, probes);
}

export async function getLatestOverview(): Promise<ControlOverview | null> {
  const snapshot = await prisma.clusterSnapshot.findFirst({
    orderBy: { observedAt: "desc" },
    include: { nodes: true },
  });
  if (!snapshot) return null;
  const probes: NodeProbe[] = snapshot.nodes.map((node) => ({
    nodeId: node.nodeId,
    httpUrl: configuredNodes().find((item) => item.nodeId === node.nodeId)?.httpUrl ?? "",
    grpcPort: configuredNodes().find((item) => item.nodeId === node.nodeId)?.grpcPort ?? 0,
    reachable: node.reachable,
    role: node.role,
    term: node.term === null ? null : Number(node.term),
    leaderId: null,
    commitIndex: node.commitIndex === null ? null : Number(node.commitIndex),
    lastApplied: node.lastApplied === null ? null : Number(node.lastApplied),
    lastLogIndex: null,
    lastLogTerm: null,
    responseTimeMs: node.responseTimeMs,
    observedAt: node.observedAt.toISOString(),
    error: node.error,
  }));
  return toOverview(snapshot, probes);
}

export function toOverview(snapshot: ClusterSnapshot & { nodes: NodeObservation[] }, probes: NodeProbe[]): ControlOverview {
  const leaderId = snapshot.leaderId;
  const stale = Date.now() - snapshot.observedAt.getTime() > STALE_AFTER_MS;
  return {
    configuredNodes: snapshot.totalNodes,
    healthyNodes: snapshot.healthyNodes,
    unavailableNodes: snapshot.unavailableNodes,
    leaderId,
    followers: probes
      .filter((probe) => probe.reachable && probe.role?.toUpperCase() === "FOLLOWER")
      .map((probe) => probe.nodeId),
    term: snapshot.term === null ? null : Number(snapshot.term),
    quorum: snapshot.quorum,
    quorumAvailable: snapshot.healthyNodes >= snapshot.quorum,
    health: snapshot.health,
    commitIndex: snapshot.commitIndex === null ? null : Number(snapshot.commitIndex),
    appliedIndex: snapshot.lastApplied === null ? null : Number(snapshot.lastApplied),
    replicationProgress: "Not available",
    lastStatusUpdate: snapshot.observedAt.toISOString(),
    stale,
    recentLeaderChanges: 0,
    openAlerts: 0,
    nodes: snapshot.nodes.map((node) => toNodeView(node, leaderId, probes.find((p) => p.nodeId === node.nodeId))),
    chaosActive: false,
  };
}

export async function enrichOverview(overview: ControlOverview): Promise<ControlOverview> {
  const [recentLeaderChanges, openAlerts] = await Promise.all([
    prisma.leaderTransition.count({
      where: { observedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    }),
    prisma.operationalAlert.count({ where: { status: { not: "RESOLVED" } } }),
  ]);
  const node = configuredNodes()[0];
  let chaosActive = false;
  if (node) {
    const status = await getChaosStatus(node.httpUrl);
    chaosActive = Boolean(
      status?.isPaused ||
      (status?.isolatedPeers?.length ?? 0) > 0 ||
      Object.keys(status?.peerDelaysMs ?? {}).length > 0 ||
      Object.keys(status?.peerDropRates ?? {}).length > 0,
    );
  }
  return { ...overview, recentLeaderChanges, openAlerts, chaosActive };
}
