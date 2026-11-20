import { randomUUID } from "node:crypto";
import { prisma, type InvestmentConnection } from "@nexus/database";
import type { InvestmentConnectionView } from "@nexus/shared-types";
import type { InvestmentConnectionInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { encryptSecret } from "@/lib/security/crypto";
import { getInvestmentAdapter, isInvestmentProviderEnabled } from "@/lib/investments/providers";
import { enqueueInvestmentSync } from "@/lib/investments/sync-service";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

export function connectionView(row: InvestmentConnection & { provider: { code: string }; consents?: Array<{ status: string; expiresAt: DateTimeLike }> }): InvestmentConnectionView {
  const consent = row.consents?.[0];
  return {
    id: row.id, providerCode: row.provider.code, status: row.status,
    maskedLabel: row.maskedLabel, lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError, consentStatus: consent?.status ?? null,
    consentExpiresAt: consent?.expiresAt?.toISOString() ?? null,
  };
}

type DateTimeLike = Date | null;

async function load(userId: string, id: string) {
  const row = await prisma.investmentConnection.findFirst({
    where: { id, userId }, include: { provider: true, consents: { orderBy: { createdAt: "desc" } } },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Investment connection not found.");
  return row;
}

export async function listConnections(userId: string) {
  const rows = await prisma.investmentConnection.findMany({
    where: { userId }, include: { provider: true, consents: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map((row) => connectionView(row));
}

export async function initiateConnection(userId: string, input: InvestmentConnectionInput) {
  if (!isInvestmentProviderEnabled(input.providerCode)) {
    throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Investment provider is not configured.");
  }
  const provider = await prisma.investmentProvider.findUniqueOrThrow({ where: { code: input.providerCode } });
  const authorizationRef = `iauth_${randomUUID()}`;
  const row = await prisma.$transaction(async (tx) => {
    const connection = await tx.investmentConnection.create({
      data: {
        userId, providerId: provider.id, status: "AUTHORIZATION_PENDING",
        providerRef: authorizationRef,
        maskedLabel: input.displayName?.slice(0, 120) ?? "Investment account",
        encryptedCredentials: encryptSecret(authorizationRef),
      },
    });
    await tx.investmentConsent.create({
      data: {
        userId, connectionId: connection.id, status: "PENDING",
        purpose: "Read-only investment portfolio synchronization",
        dataCategories: ["HOLDINGS", "TRANSACTIONS", "VALUATIONS"],
        termsVersion: "r16-v1",
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });
    await tx.investmentConsentEvent.create({
      data: { consentId: (await tx.investmentConsent.findFirstOrThrow({ where: { connectionId: connection.id } })).id, event: "CONSENT_REQUESTED", actor: userId },
    });
    return connection;
  });
  await publishSecurityEvent({
    eventId: `inv_conn_${row.id}`, type: "INVESTMENT_CONNECTION_INITIATED", occurredAt: new Date(),
    actorId: userId, subjectId: row.id, sourceModule: "investments",
    metadata: { providerCode: input.providerCode },
  });
  await securityAudit({
    actorType: "USER", actorId: userId, action: "INVESTMENT_CONNECTION_INITIATED",
    targetType: "investment_connection", targetId: row.id,
  });
  return {
    ...connectionView(await load(userId, row.id)),
    authorizationRef,
    notice: "Provider-hosted authorization is simulated by the labelled sandbox. No broker password, PIN, OTP or depository credential is collected.",
  };
}

/** Sandbox stand-in for a provider-hosted authorization callback. */
export async function completeConnection(userId: string, id: string) {
  const connection = await load(userId, id);
  if (connection.status !== "AUTHORIZATION_PENDING") throw new ApiError(409, "PAYMENT_ERROR", "Connection is not awaiting authorization.");
  await prisma.$transaction(async (tx) => {
    await tx.investmentConnection.update({ where: { id }, data: { status: "ACTIVE" } });
    await tx.investmentConsent.updateMany({
      where: { connectionId: id, status: "PENDING" },
      data: { status: "ACTIVE", consentedAt: new Date(), expiresAt: new Date(Date.now() + 90 * 86_400_000) },
    });
    await tx.investmentConsentEvent.create({
      data: { consentId: (await tx.investmentConsent.findFirstOrThrow({ where: { connectionId: id } })).id, event: "CONSENT_GRANTED", actor: userId },
    });
  });
  await publishSecurityEvent({
    eventId: `inv_connected_${id}`, type: "INVESTMENT_CONNECTED", occurredAt: new Date(),
    actorId: userId, subjectId: id, sourceModule: "investments",
  });
  await enqueueInvestmentSync(id, "FULL_SYNC");
  return connectionView(await load(userId, id));
}

export async function disconnectConnection(userId: string, id: string) {
  await load(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.investmentConnection.update({ where: { id }, data: { status: "DISCONNECTED", encryptedCredentials: null } });
    await tx.investmentConsent.updateMany({ where: { connectionId: id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
    await tx.investmentSyncJob.updateMany({
      where: { connectionId: id, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "FAILED", error: "Connection disconnected" },
    });
  });
  await publishSecurityEvent({
    eventId: `inv_disc_${id}`, type: "INVESTMENT_DISCONNECTED", occurredAt: new Date(),
    actorId: userId, subjectId: id, sourceModule: "investments",
  });
  await securityAudit({ actorType: "USER", actorId: userId, action: "INVESTMENT_DISCONNECTED", targetType: "investment_connection", targetId: id });
  return connectionView(await load(userId, id));
}

export async function revokeConsent(userId: string, id: string) {
  await load(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.investmentConsent.updateMany({ where: { connectionId: id, status: { in: ["ACTIVE", "PENDING"] } }, data: { status: "REVOKED", revokedAt: new Date() } });
    await tx.investmentConnection.update({ where: { id }, data: { status: "REVOKED" } });
    await tx.investmentSyncJob.updateMany({ where: { connectionId: id, status: "PENDING" }, data: { status: "FAILED", error: "Consent revoked" } });
  });
  await securityAudit({ actorType: "USER", actorId: userId, action: "INVESTMENT_CONSENT_REVOKED", targetType: "investment_connection", targetId: id });
  return connectionView(await load(userId, id));
}

export async function requireActiveConsent(connectionId: string) {
  const consent = await prisma.investmentConsent.findFirst({
    where: { connectionId, status: "ACTIVE" }, orderBy: { createdAt: "desc" },
  });
  if (!consent || (consent.expiresAt && consent.expiresAt <= new Date())) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "No active investment consent for this connection.");
  }
  return consent;
}

/** Read-only adapter accessor for sync paths; verifies consent before provider access. */
export async function adapterForConnection(connectionId: string) {
  const connection = await prisma.investmentConnection.findUniqueOrThrow({
    where: { id: connectionId }, include: { provider: true },
  });
  // Consent is checked first so a revoked consent is never mistaken for a generic sync failure.
  await requireActiveConsent(connectionId);
  if (connection.status !== "ACTIVE" && connection.status !== "SYNCING") {
    throw new ApiError(409, "PAYMENT_ERROR", "Investment connection is not active.");
  }
  return { connection, adapter: getInvestmentAdapter(connection.provider.code) };
}

