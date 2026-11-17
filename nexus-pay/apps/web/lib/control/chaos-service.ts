import { prisma, Prisma } from "@nexus/database";
import type { AdminRole, ChaosOperationView, ChaosScenario } from "@nexus/shared-types";
import type { ChaosHealInput, ChaosInjectInput } from "@nexus/validation";
import { getServerEnv } from "@/lib/env";
import { recordAdminAudit } from "@/lib/control/audit";
import { collectClusterSnapshot, getLatestOverview } from "@/lib/control/collector";
import {
  configuredNodes,
  healChaos,
  injectChaos,
} from "@/lib/control/raftline-adapter";
import { hasPermission } from "@/lib/control/auth";

const DESTRUCTIVE_SCENARIOS: ChaosScenario[] = [
  "KILL_LEADER",
  "PARTITION_MAJORITY",
  "PARTITION_NODE",
  "FREEZE_NODE",
  "ASYMMETRIC_PARTITION",
  "CUSTOM",
  "PACKET_JITTER_STORM",
  "PARTITION_MINORITY",
];

function toView(operation: {
  id: string;
  actorId: string;
  actorRole: string;
  nodeId: string;
  scenario: string;
  target: string | null;
  peer: string | null;
  reason: string;
  status: string;
  requestedAt: Date;
  completedAt: Date | null;
  response: unknown;
  error: string | null;
  events: Array<{ id: string; eventType: string; message: string; createdAt: Date }>;
}): ChaosOperationView {
  return {
    id: operation.id,
    actorId: operation.actorId,
    actorRole: operation.actorRole,
    nodeId: operation.nodeId,
    scenario: operation.scenario as ChaosScenario,
    target: operation.target,
    peer: operation.peer,
    reason: operation.reason,
    status: operation.status as ChaosOperationView["status"],
    requestedAt: operation.requestedAt.toISOString(),
    completedAt: operation.completedAt?.toISOString() ?? null,
    response: (operation.response ?? {}) as Record<string, unknown>,
    error: operation.error,
    events: operation.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function listChaosOperations(limit = 50): Promise<ChaosOperationView[]> {
  const operations = await prisma.chaosOperation.findMany({
    include: { events: { orderBy: { createdAt: "asc" } } },
    orderBy: { requestedAt: "desc" },
    take: limit,
  });
  return operations.map(toView);
}

export async function getChaosOperation(id: string): Promise<ChaosOperationView | null> {
  const operation = await prisma.chaosOperation.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  return operation ? toView(operation) : null;
}

async function guarded(
  admin: { id: string; email: string; role: AdminRole },
  permission: string,
): Promise<string | null> {
  if (!hasPermission(admin.role, permission)) {
    await recordAdminAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: "ADMIN_PERMISSION_DENIED",
      targetType: "chaos",
      targetId: permission,
      outcome: "BLOCKED",
    });
    return "Your role cannot perform this operation.";
  }
  if (!getServerEnv().NEXUS_CONTROL_CHAOS_ENABLED) {
    return "Chaos engineering is disabled in this environment.";
  }
  return null;
}

export async function injectChaosOperation(
  admin: { id: string; email: string; role: AdminRole },
  input: ChaosInjectInput,
  requestId: string,
): Promise<ChaosOperationView> {
  const denied = await guarded(admin, "chaos:write");
  if (denied) throw new Error(denied);

  const nodeConfig = configuredNodes().find((node) => node.nodeId === input.nodeId);
  if (!nodeConfig) throw new Error("The target node is not configured.");

  const overview = await getLatestOverview();
  const healthy = overview?.healthyNodes ?? 0;
  const quorum = overview?.quorum ?? 3;

  if (DESTRUCTIVE_SCENARIOS.includes(input.scenario) && healthy <= quorum) {
    throw new Error("Safety limit: fewer than four nodes are healthy. Injection blocked to protect quorum.");
  }
  if (input.scenario === "PARTITION_MAJORITY" && !getServerEnv().NEXUS_CONTROL_ALLOW_QUORUM_LOSS) {
    throw new Error("Majority partition is disabled. Enable NEXUS_CONTROL_ALLOW_QUORUM_LOSS in an isolated test environment.");
  }
  if (input.scenario === "KILL_LEADER" && overview?.leaderId && overview.leaderId !== input.nodeId) {
    throw new Error("KILL_LEADER must target the currently observed leader.");
  }

  const duplicate = await prisma.chaosOperation.findFirst({
    where: {
      nodeId: input.nodeId,
      scenario: input.scenario,
      reason: input.reason,
      requestedAt: { gte: new Date(Date.now() - 30_000) },
    },
  });
  if (duplicate) throw new Error("An identical chaos operation was already submitted. Wait before retrying.");

  const operation = await prisma.chaosOperation.create({
    data: {
      actorId: admin.id,
      actorRole: admin.role,
      nodeId: input.nodeId,
      scenario: input.scenario,
      target: input.target ?? null,
      peer: input.peer ?? null,
      reason: input.reason,
      status: "REQUESTED",
      requestId,
      request: input as unknown as object,
    },
  });
  await prisma.chaosOperationEvent.create({
    data: {
      operationId: operation.id,
      eventType: "REQUESTED",
      message: `${input.scenario} requested against ${input.nodeId}`,
      metadata: { reason: input.reason },
    },
  });

  const result = await injectChaos(nodeConfig.httpUrl, input.scenario, {
    target: input.target,
    peer: input.peer,
    delayMs: input.delayMs,
    dropRate: input.dropRate,
  });

  await prisma.chaosOperation.update({
    where: { id: operation.id },
    data: {
      status: result.ok ? "INJECTED" : "FAILED",
      response: result.response as unknown as Prisma.InputJsonValue,
      error: result.error,
      completedAt: new Date(),
    },
  });
  await prisma.chaosOperationEvent.create({
    data: {
      operationId: operation.id,
      eventType: result.ok ? "INJECTED" : "FAILED",
      message: result.ok
        ? `Raftline accepted ${result.response.scenario ?? input.scenario} (event ${result.response.eventId ?? "unknown"})`
        : `Raftline rejected the request: ${result.error}`,
      metadata: result.response as object,
    },
  });
  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.role,
    action: result.ok ? "CHAOS_INJECTED" : "CHAOS_INJECTION_FAILED",
    targetType: "node",
    targetId: input.nodeId,
    reason: input.reason,
    requestId,
    outcome: result.ok ? "SUCCESS" : "FAILURE",
    metadata: { scenario: input.scenario, response: result.response } as unknown as Prisma.InputJsonValue,
  });

  if (result.ok) await collectClusterSnapshot().catch(() => undefined);
  return (await getChaosOperation(operation.id))!;
}

export async function healChaosOperation(
  admin: { id: string; email: string; role: AdminRole },
  input: ChaosHealInput,
  requestId: string,
): Promise<ChaosOperationView> {
  const denied = await guarded(admin, "chaos:heal");
  if (denied) throw new Error(denied);

  const nodeConfig = configuredNodes().find((node) => node.nodeId === input.nodeId);
  if (!nodeConfig) throw new Error("The target node is not configured.");

  const operation = await prisma.chaosOperation.create({
    data: {
      actorId: admin.id,
      actorRole: admin.role,
      nodeId: input.nodeId,
      scenario: "HEAL_ALL",
      peer: input.peer ?? null,
      reason: input.reason,
      status: "REQUESTED",
      requestId,
      request: input as unknown as object,
    },
  });
  await prisma.chaosOperationEvent.create({
    data: {
      operationId: operation.id,
      eventType: "REQUESTED",
      message: `Heal requested for ${input.nodeId}`,
      metadata: { all: input.all, peer: input.peer ?? null },
    },
  });

  const result = await healChaos(nodeConfig.httpUrl, { peer: input.peer, all: input.all });
  await prisma.chaosOperation.update({
    where: { id: operation.id },
    data: {
      status: result.ok ? "HEALED" : "FAILED",
      response: result.response as unknown as Prisma.InputJsonValue,
      error: result.error,
      completedAt: new Date(),
    },
  });
  await prisma.chaosOperationEvent.create({
    data: {
      operationId: operation.id,
      eventType: result.ok ? "HEALED" : "FAILED",
      message: result.ok
        ? `Heal request accepted: ${JSON.stringify(result.response)}`
        : `Heal request failed: ${result.error}`,
      metadata: result.response as object,
    },
  });
  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.role,
    action: result.ok ? "CHAOS_HEALED" : "CHAOS_HEAL_FAILED",
    targetType: "node",
    targetId: input.nodeId,
    reason: input.reason,
    requestId,
    outcome: result.ok ? "SUCCESS" : "FAILURE",
    metadata: { response: result.response } as unknown as Prisma.InputJsonValue,
  });

  if (result.ok) await collectClusterSnapshot().catch(() => undefined);
  return (await getChaosOperation(operation.id))!;
}
