import { describe, expect, it } from "vitest";
import { deriveClusterHealth } from "../../apps/web/lib/control/collector";
import { hasPermission } from "../../apps/web/lib/control/auth";
import type { NodeProbe } from "../../apps/web/lib/control/raftline-adapter";
import { chaosInjectSchema } from "../../packages/validation/src/index";

function probe(nodeId: string, reachable: boolean, role: string | null, leaderId: string | null): NodeProbe {
  return {
    nodeId,
    httpUrl: `http://localhost:800${nodeId.slice(-1)}`,
    grpcPort: 9000 + Number(nodeId.slice(-1)),
    reachable,
    role,
    term: 10,
    leaderId,
    commitIndex: 100,
    lastApplied: 100,
    lastLogIndex: 100,
    lastLogTerm: 10,
    responseTimeMs: 12,
    observedAt: new Date().toISOString(),
    error: reachable ? null : "timeout",
  };
}

describe("Release 5 control engines", () => {
  it("derives health states from observed node data", () => {
    const five = [1, 2, 3, 4, 5].map((n) => probe(`node-${n}`, true, n === 1 ? "LEADER" : "FOLLOWER", "node-1"));
    expect(deriveClusterHealth(five, "node-1", false)).toBe("HEALTHY");
    expect(deriveClusterHealth(five, null, false)).toBe("NO_LEADER");
    expect(deriveClusterHealth(five, "node-1", true)).toBe("RECOVERING");

    const degraded = five.map((node, index) => (index === 4 ? probe(node.nodeId, false, null, null) : node));
    expect(deriveClusterHealth(degraded, "node-1", false)).toBe("DEGRADED");

    const noQuorum = five.map((node, index) => (index >= 2 ? probe(node.nodeId, false, null, null) : node));
    expect(deriveClusterHealth(noQuorum, null, false)).toBe("QUORUM_LOST");
    expect(deriveClusterHealth(five.map((node) => probe(node.nodeId, false, null, null)), null, false)).toBe("UNKNOWN");
  });

  it("enforces role permissions on the server", () => {
    expect(hasPermission("SUPER_ADMIN", "admin:write")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "chaos:write")).toBe(true);
    expect(hasPermission("OPERATOR", "chaos:write")).toBe(true);
    expect(hasPermission("OPERATOR", "admin:write")).toBe(false);
    expect(hasPermission("VIEWER", "chaos:write")).toBe(false);
    expect(hasPermission("VIEWER", "chaos:heal")).toBe(false);
    expect(hasPermission("VIEWER", "cluster:read")).toBe(true);
  });

  it("validates chaos input before any backend call", () => {
    expect(
      chaosInjectSchema.safeParse({ nodeId: "node-2", scenario: "PARTITION_NODE", reason: "Drill" }).success,
    ).toBe(true);
    expect(
      chaosInjectSchema.safeParse({ nodeId: "node-9", scenario: "PARTITION_NODE", reason: "Drill" }).success,
    ).toBe(false);
    expect(
      chaosInjectSchema.safeParse({ nodeId: "node-2", scenario: "NOT_A_SCENARIO", reason: "Drill" }).success,
    ).toBe(false);
    expect(
      chaosInjectSchema.safeParse({ nodeId: "node-2", scenario: "PARTITION_NODE", reason: "x" }).success,
    ).toBe(false);
    expect(
      chaosInjectSchema.safeParse({ nodeId: "node-2", scenario: "CUSTOM", reason: "Drill" }).success,
    ).toBe(false);
  });
});
