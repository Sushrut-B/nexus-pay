// ==============================================================================
// Nexus Clearing — Raftline Domain Models & TypeScript Contracts
// Strongly typed to match Raftline Core Consensus & FinTech Payment Engine
// ==============================================================================

export type PaymentRail =
  | "FEDNOW"
  | "SEPA_INSTANT"
  | "UPI"
  | "FASTER_PAYMENTS"
  | "INTERNAL_BOOK";

export type PaymentStatus =
  | "SETTLED"
  | "AUTHORIZED"
  | "CAPTURED"
  | "VOIDED"
  | "REJECTED";

export type RaftRole = "LEADER" | "FOLLOWER" | "CANDIDATE" | "PRE_CANDIDATE";

export interface ClusterNodeStatus {
  nodeId: string;
  role: RaftRole;
  term: number;
  commitIndex: number;
  lastApplied: number;
  lastLogIndex: number;
  lastLogTerm: number;
  leaderId: string | null;
  leaderHint?: string | null;
  discoveredLeaderId?: string | null;
  discoveredLeaderUrl?: string | null;
  httpPort?: number;
  grpcPort?: number;
  reachable?: boolean;
  latencyMs?: number;
}

export interface PaymentAccount {
  accountId: string;
  tenantId: string;
  currency: string;
  balanceCents: number;
  reservedCents: number;
  availableBalanceCents: number;
  status: "ACTIVE" | "FROZEN" | "CLOSED";
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, string>;
}

export interface PaymentInstruction {
  idempotencyKey: string;
  rail: PaymentRail;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  currency: string;
  description?: string;
  tenantId?: string;
}

export interface PaymentResult {
  paymentRef: string;
  idempotencyKey: string;
  status: PaymentStatus;
  rail: PaymentRail;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  currency: string;
  sourceBalanceAfter: number;
  destinationBalanceAfter: number;
  rejectionReason: string | null;
  settledAt: number;
  raftLogIndex: number;
  isIdempotentReplay: boolean;
}

export interface PaymentHold {
  holdId: string;
  tenantId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  status: PaymentStatus;
  createdAt: number;
  expiresAt: number;
}

export interface SettlementMetrics {
  totalSettledCount: number;
  totalSettledVolumeCents: number;
  totalRejectedCount: number;
  totalIdempotentReplays: number;
  activeAccountsCount: number;
}

export type ChaosScenario =
  | "KILL_LEADER"
  | "PARTITION_NODE"
  | "PARTITION_MINORITY"
  | "PARTITION_MAJORITY"
  | "ASYMMETRIC_PARTITION"
  | "PACKET_JITTER_STORM"
  | "FREEZE_NODE"
  | "HEAL_ALL"
  | "CUSTOM";

export interface ChaosEvent {
  status: string;
  eventId: string;
  scenario: ChaosScenario;
  target?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface DemoCustomerProfile {
  id: string;
  name: string;
  type: string;
  currency: string;
  routingOrVpa: string;
  avatarColor: string;
  accountId: string;
}

