/**
 * Release 5 — Nexus Control contracts.
 *
 * These types describe observations, administrative actions and audit records.
 * They are never a financial ledger and never represent authoritative balances.
 */

export const ADMIN_ROLES = ["SUPER_ADMIN", "OPERATOR", "VIEWER"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super admin",
  OPERATOR: "Operator",
  VIEWER: "Viewer",
};

export const CLUSTER_HEALTH_STATES = [
  "HEALTHY",
  "DEGRADED",
  "NO_LEADER",
  "QUORUM_LOST",
  "NODE_UNAVAILABLE",
  "RECOVERING",
  "UNKNOWN",
] as const;
export type ClusterHealth = (typeof CLUSTER_HEALTH_STATES)[number];

export const CHAOS_SCENARIOS = [
  "KILL_LEADER",
  "PARTITION_NODE",
  "PARTITION_MINORITY",
  "PARTITION_MAJORITY",
  "ASYMMETRIC_PARTITION",
  "PACKET_JITTER_STORM",
  "FREEZE_NODE",
  "HEAL_ALL",
  "CUSTOM",
] as const;
export type ChaosScenario = (typeof CHAOS_SCENARIOS)[number];

export const CHAOS_SCENARIO_INFO: Record<ChaosScenario, { label: string; impact: string; needsPeer: boolean }> = {
  KILL_LEADER: { label: "Abdicate current leader", impact: "Forces the contacted leader to step down and triggers an election.", needsPeer: false },
  PARTITION_NODE: { label: "Isolate node from peers", impact: "The contacted node loses connectivity to selected peers.", needsPeer: false },
  PARTITION_MINORITY: { label: "Minority partition", impact: "A minority of peers is isolated; quorum should remain available.", needsPeer: false },
  PARTITION_MAJORITY: { label: "Majority partition", impact: "A majority of peers is isolated; quorum may be lost. Blocked by default.", needsPeer: false },
  ASYMMETRIC_PARTITION: { label: "Asymmetric partition", impact: "Outbound traffic to one peer is dropped while inbound remains.", needsPeer: true },
  PACKET_JITTER_STORM: { label: "Packet jitter storm", impact: "Adds latency and packet loss across peer links.", needsPeer: false },
  FREEZE_NODE: { label: "Freeze node", impact: "Simulates a pause or hang on the contacted node.", needsPeer: false },
  HEAL_ALL: { label: "Heal all faults", impact: "Clears active chaos faults on the contacted node.", needsPeer: false },
  CUSTOM: { label: "Custom network fault", impact: "Applies explicit peer delay, drop rate and isolation settings.", needsPeer: true },
};

export const ALERT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const CHAOS_OPERATION_STATUSES = ["REQUESTED", "INJECTED", "HEALED", "FAILED", "BLOCKED"] as const;
export type ChaosOperationStatus = (typeof CHAOS_OPERATION_STATUSES)[number];

export const RECONCILIATION_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "RESOLVED_SETTLED",
  "RESOLVED_REJECTED",
  "UNRESOLVED",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export interface NodeView {
  nodeId: string;
  httpUrl: string;
  grpcPort: number;
  reachable: boolean;
  role: string | null;
  term: number | null;
  commitIndex: number | null;
  lastApplied: number | null;
  lastLogIndex: number | null;
  responseTimeMs: number | null;
  lastSuccessfulCheck: string | null;
  observedAt: string;
  error: string | null;
  isLeader: boolean;
  health: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
}

export interface ControlOverview {
  configuredNodes: number;
  healthyNodes: number;
  unavailableNodes: number;
  leaderId: string | null;
  followers: string[];
  term: number | null;
  quorum: number;
  quorumAvailable: boolean;
  health: ClusterHealth;
  commitIndex: number | null;
  appliedIndex: number | null;
  replicationProgress: "Not available";
  lastStatusUpdate: string | null;
  stale: boolean;
  recentLeaderChanges: number;
  openAlerts: number;
  nodes: NodeView[];
  chaosActive: boolean;
}

export interface LeaderTransitionView {
  id: string;
  fromLeaderId: string | null;
  toLeaderId: string | null;
  term: number | null;
  observedAt: string;
  source: string;
}

export interface ChaosOperationView {
  id: string;
  actorId: string;
  actorRole: string;
  nodeId: string;
  scenario: ChaosScenario;
  target: string | null;
  peer: string | null;
  reason: string;
  status: ChaosOperationStatus;
  requestedAt: string;
  completedAt: string | null;
  response: Record<string, unknown>;
  error: string | null;
  events: Array<{ id: string; eventType: string; message: string; createdAt: string }>;
}

export interface AlertView {
  id: string;
  fingerprint: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  status: AlertStatus;
  nodeId: string | null;
  paymentRef: string | null;
  suggestedSteps: string | null;
  firstDetectedAt: string;
  lastObservedAt: string;
  resolvedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

export interface AdminAuditView {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentOperationView {
  intentId: string;
  paymentRef: string | null;
  idempotencyKeyMasked: string;
  senderWalletMasked: string;
  recipientWalletMasked: string;
  amountMinor: number;
  currency: string;
  rail: string;
  status: string;
  transactionStatus: string | null;
  createdAt: string;
  updatedAt: string;
  rejectionCode: string | null;
  failureMessage: string | null;
  idempotentReplay: boolean;
  raftLogIndex: number | null;
  settlement: "NEW_SUCCESS" | "REJECTED" | "IDEMPOTENT_REPLAY" | "UNCERTAIN";
}

export interface ReconciliationCaseView {
  id: string;
  paymentIntentId: string;
  paymentRef: string | null;
  idempotencyKeyMasked: string;
  applicationStatus: string;
  status: ReconciliationStatus;
  decision: string | null;
  reason: string | null;
  operatorId: string | null;
  evidence: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
  attempts: Array<{ id: string; outcome: string; createdAt: string; error: string | null }>;
}

export interface MetricsView {
  range: { from: string; to: string };
  samples: number;
  availability: Array<{ at: string; percentage: number; healthy: number; total: number }>;
  leaderChanges: number;
  paymentSettlements: number;
  paymentFailures: number;
  successRate: number | null;
  averageResponseMs: number | null;
  replicationLag: "Not available";
  source: "NEXUS_OBSERVED";
}
