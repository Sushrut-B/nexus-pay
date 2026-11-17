-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ClusterHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'NO_LEADER', 'QUORUM_LOST', 'NODE_UNAVAILABLE', 'RECOVERING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ChaosOperationStatus" AS ENUM ('REQUESTED', 'INJECTED', 'HEALED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED_SETTLED', 'RESOLVED_REJECTED', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "username" VARCHAR(30) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" VARCHAR(64),
    "actorEmail" VARCHAR(254),
    "actorRole" VARCHAR(30) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(500),
    "requestId" VARCHAR(64),
    "ipAddress" VARCHAR(64),
    "outcome" VARCHAR(30) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cluster_snapshots" (
    "id" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaderId" VARCHAR(40),
    "term" BIGINT,
    "commitIndex" BIGINT,
    "lastApplied" BIGINT,
    "healthyNodes" INTEGER NOT NULL,
    "unavailableNodes" INTEGER NOT NULL,
    "quorum" INTEGER NOT NULL,
    "totalNodes" INTEGER NOT NULL,
    "health" "ClusterHealth" NOT NULL,
    "capturedMs" INTEGER NOT NULL,

    CONSTRAINT "cluster_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_observations" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "nodeId" VARCHAR(40) NOT NULL,
    "reachable" BOOLEAN NOT NULL,
    "role" VARCHAR(30),
    "term" BIGINT,
    "commitIndex" BIGINT,
    "lastApplied" BIGINT,
    "responseTimeMs" INTEGER NOT NULL,
    "error" VARCHAR(300),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leader_transitions" (
    "id" TEXT NOT NULL,
    "fromLeaderId" VARCHAR(40),
    "toLeaderId" VARCHAR(40),
    "term" BIGINT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(30) NOT NULL DEFAULT 'OBSERVED',
    "snapshotId" TEXT,

    CONSTRAINT "leader_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chaos_operations" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" VARCHAR(30) NOT NULL,
    "nodeId" VARCHAR(40) NOT NULL,
    "scenario" VARCHAR(40) NOT NULL,
    "target" VARCHAR(80),
    "peer" VARCHAR(40),
    "reason" VARCHAR(500) NOT NULL,
    "status" "ChaosOperationStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestId" VARCHAR(80) NOT NULL,
    "request" JSONB NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "error" VARCHAR(400),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "chaos_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chaos_operation_events" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "eventType" VARCHAR(40) NOT NULL,
    "message" VARCHAR(400) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chaos_operation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_alerts" (
    "id" TEXT NOT NULL,
    "fingerprint" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(600) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "nodeId" VARCHAR(40),
    "paymentRef" VARCHAR(80),
    "suggestedSteps" VARCHAR(600),
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedBy" VARCHAR(64),
    "acknowledgedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_cases" (
    "id" TEXT NOT NULL,
    "paymentIntentId" VARCHAR(64) NOT NULL,
    "paymentRef" VARCHAR(80),
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "applicationStatus" VARCHAR(40) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "decision" VARCHAR(200),
    "reason" VARCHAR(500),
    "operatorId" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "reconciliation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_attempts" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "operatorId" VARCHAR(64),
    "outcome" VARCHAR(60) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "error" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE INDEX "admin_users_role_isActive_idx" ON "admin_users"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_tokenHash_key" ON "admin_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_sessions_adminUserId_expiresAt_idx" ON "admin_sessions"("adminUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actorId_createdAt_idx" ON "admin_audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_createdAt_idx" ON "admin_audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_targetType_targetId_idx" ON "admin_audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "cluster_snapshots_observedAt_idx" ON "cluster_snapshots"("observedAt");

-- CreateIndex
CREATE INDEX "cluster_snapshots_leaderId_observedAt_idx" ON "cluster_snapshots"("leaderId", "observedAt");

-- CreateIndex
CREATE INDEX "node_observations_nodeId_observedAt_idx" ON "node_observations"("nodeId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "node_observations_snapshotId_nodeId_key" ON "node_observations"("snapshotId", "nodeId");

-- CreateIndex
CREATE INDEX "leader_transitions_observedAt_idx" ON "leader_transitions"("observedAt");

-- CreateIndex
CREATE INDEX "leader_transitions_toLeaderId_observedAt_idx" ON "leader_transitions"("toLeaderId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "chaos_operations_requestId_key" ON "chaos_operations"("requestId");

-- CreateIndex
CREATE INDEX "chaos_operations_nodeId_requestedAt_idx" ON "chaos_operations"("nodeId", "requestedAt");

-- CreateIndex
CREATE INDEX "chaos_operations_status_requestedAt_idx" ON "chaos_operations"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "chaos_operation_events_operationId_createdAt_idx" ON "chaos_operation_events"("operationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "operational_alerts_fingerprint_key" ON "operational_alerts"("fingerprint");

-- CreateIndex
CREATE INDEX "operational_alerts_status_severity_lastObservedAt_idx" ON "operational_alerts"("status", "severity", "lastObservedAt");

-- CreateIndex
CREATE INDEX "reconciliation_cases_status_createdAt_idx" ON "reconciliation_cases"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_cases_paymentIntentId_key" ON "reconciliation_cases"("paymentIntentId");

-- CreateIndex
CREATE INDEX "reconciliation_attempts_caseId_createdAt_idx" ON "reconciliation_attempts"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_observations" ADD CONSTRAINT "node_observations_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "cluster_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chaos_operations" ADD CONSTRAINT "chaos_operations_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chaos_operation_events" ADD CONSTRAINT "chaos_operation_events_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "chaos_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_attempts" ADD CONSTRAINT "reconciliation_attempts_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "reconciliation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
