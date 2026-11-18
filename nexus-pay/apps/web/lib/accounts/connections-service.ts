import { randomBytes } from "node:crypto";
import { prisma, type ExternalConnectionStatus } from "@nexus/database";
import type { ConnectionInitiation, ConnectionView, ConsentView, ProviderView } from "@nexus/shared-types";
import type { ConnectAccountInput, ProviderCallbackInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { hashToken } from "@/lib/security/tokens";
import { encryptSecret } from "@/lib/security/crypto";
import { createNotification } from "@/lib/social/shared";
import {
  ensureProviderRecords, getProviderAdapter, listAvailableProviders, SANDBOX_NOTICE,
} from "@/lib/accounts/providers";

const TRANSITIONS: Record<ExternalConnectionStatus, ExternalConnectionStatus[]> = {
  NOT_CONNECTED: ["INITIATING"],
  INITIATING: ["AWAITING_USER_AUTHORIZATION", "FAILED"],
  AWAITING_USER_AUTHORIZATION: ["AUTHORIZED", "FAILED", "REQUIRES_ATTENTION"],
  AUTHORIZED: ["SYNC_PENDING", "PARTIALLY_CONNECTED", "FAILED"],
  SYNC_PENDING: ["ACTIVE", "PARTIALLY_CONNECTED", "FAILED"],
  ACTIVE: ["PARTIALLY_CONNECTED", "EXPIRED", "REVOKED", "FAILED", "REQUIRES_ATTENTION"],
  PARTIALLY_CONNECTED: ["ACTIVE", "EXPIRED", "REVOKED", "REQUIRES_ATTENTION"],
  EXPIRED: ["REVOKED", "REQUIRES_ATTENTION"],
  REVOKED: [],
  FAILED: ["INITIATING", "REQUIRES_ATTENTION"],
  REQUIRES_ATTENTION: ["ACTIVE", "REVOKED", "FAILED"],
};

function requireTransition(from: ExternalConnectionStatus, to: ExternalConnectionStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ApiError(409, "PAYMENT_ERROR", `Invalid connection transition ${from} -> ${to}.`);
  }
}

export async function listProviders(): Promise<ProviderView[]> {
  await ensureProviderRecords();
  const rows = await prisma.externalFinancialProvider.findMany({ orderBy: { displayName: "asc" } });
  const available = new Map(listAvailableProviders().map((item) => [item.code, item]));
  return rows.map((row) => {
    const info = available.get(row.code);
    return {
      id: row.id,
      code: row.code,
      displayName: row.displayName,
      mode: row.mode,
      capabilities: row.capabilities as Record<string, boolean>,
      status: row.status,
      available: row.status === "AVAILABLE" && Boolean(info?.available),
      notice: info?.notice ?? "Provider not configured.",
    };
  });
}

export async function initiateConnection(userId: string, input: ConnectAccountInput): Promise<ConnectionInitiation> {
  const adapter = getProviderAdapter(input.providerCode);
  await ensureProviderRecords();
  const provider = await prisma.externalFinancialProvider.findUniqueOrThrow({ where: { code: input.providerCode } });
  const state = randomBytes(24).toString("base64url");
  const stateHash = hashToken(state);
  const result = await adapter.initiateConnection({ userId, state, purpose: input.purpose, dataCategories: input.dataCategories });

  const connection = await prisma.$transaction(async (tx) => {
    const created = await tx.externalAccountConnection.create({
      data: {
        userId,
        providerId: provider.id,
        status: "INITIATING",
        providerConnectionRef: result.providerConnectionRef,
        callbackStateHash: stateHash,
        stateExpiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const expiresAt = new Date(Date.now() + input.durationDays * 86_400_000);
    await tx.externalAccountConsent.create({
      data: {
        connectionId: created.id,
        userId,
        status: "PENDING",
        purpose: input.purpose,
        dataCategories: [...input.dataCategories],
        periodFrom: new Date(`${input.periodFrom}T00:00:00.000Z`),
        periodTo: new Date(`${input.periodTo}T23:59:59.999Z`),
        durationDays: input.durationDays,
        refreshFrequencyMinutes: input.refreshFrequencyMinutes,
        termsVersion: "sandbox-v1",
        expiresAt,
      },
    });
    await tx.consentEvent.create({
      data: { consentId: (await tx.externalAccountConsent.findFirstOrThrow({ where: { connectionId: created.id } })).id, event: "CONSENT_REQUESTED", actor: userId },
    });
    await tx.dataAccessAuditEvent.create({
      data: { userId, actorType: "USER", actorId: userId, action: "EXTERNAL_CONNECTION_INITIATED", targetType: "connection", targetId: created.id },
    });
    return created;
  });

  await prisma.externalAccountConnection.update({
    where: { id: connection.id },
    data: { status: "AWAITING_USER_AUTHORIZATION" },
  });

  return {
    connectionId: connection.id,
    providerCode: input.providerCode,
    authorizationUrl: result.authorizationUrl,
    state,
    status: "AWAITING_USER_AUTHORIZATION",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    notice: result.notice,
  };
}

/** Verified callback. Replays are recorded but never create duplicate connections. */
export async function handleCallback(input: ProviderCallbackInput): Promise<{ connectionId: string; status: ConnectionView["status"] }> {
  const stateHash = hashToken(input.state);
  const connection = await prisma.externalAccountConnection.findFirst({ where: { callbackStateHash: stateHash } });
  if (!connection) throw new ApiError(404, "AUTHORIZATION_ERROR", "Unknown or expired connection state.");
  if (connection.stateExpiresAt && connection.stateExpiresAt <= new Date()) {
    throw new ApiError(410, "AUTHORIZATION_ERROR", "Connection session has expired.");
  }
  const provider = await prisma.externalFinancialProvider.findUniqueOrThrow({ where: { id: connection.providerId } });
  const adapter = getProviderAdapter(provider.code);

  const existingEvent = await prisma.providerCallbackEvent.findUnique({
    where: {
      providerId_providerRef_eventType: {
        providerId: provider.id,
        providerRef: input.providerRef ?? input.code ?? input.state,
        eventType: "AUTHORIZATION_CALLBACK",
      },
    },
  });
  if (existingEvent) {
    await prisma.providerCallbackEvent.update({
      where: { id: existingEvent.id }, data: { status: "REPLAYED" },
    });
    return { connectionId: connection.id, status: connection.status };
  }

  const signatureValid = adapter.verifyCallback(input);
  const event = await prisma.providerCallbackEvent.create({
    data: {
      providerId: provider.id,
      eventType: "AUTHORIZATION_CALLBACK",
      providerRef: input.providerRef ?? input.code ?? input.state,
      payload: { code: input.code, providerRef: input.providerRef, error: input.error } as object,
      signatureValid,
      status: "RECEIVED",
    },
  });
  if (input.error || !signatureValid) {
    await prisma.providerCallbackEvent.update({ where: { id: event.id }, data: { status: "FAILED", error: input.error ?? "Invalid callback" } });
    await prisma.externalAccountConnection.update({ where: { id: connection.id }, data: { status: "FAILED", lastError: input.error ?? "Invalid callback" } });
    throw new ApiError(400, "VALIDATION_ERROR", input.error ?? "Provider callback could not be verified.");
  }

  const callback = await adapter.handleCallback(input);
  if (callback.providerConnectionRef !== connection.providerConnectionRef) {
    throw new ApiError(409, "VALIDATION_ERROR", "Callback does not match the initiated connection.");
  }

  const consent = await prisma.externalAccountConsent.findFirstOrThrow({
    where: { connectionId: connection.id }, orderBy: { createdAt: "desc" },
  });

  await prisma.$transaction(async (tx) => {
    requireTransition(connection.status, "AUTHORIZED");
    await tx.externalAccountConnection.update({
      where: { id: connection.id },
      data: { status: "AUTHORIZED", stateExpiresAt: null, lastError: null },
    });
    await tx.externalAccountConsent.update({ where: { id: consent.id }, data: { status: "ACTIVE", providerConsentRef: `consent:${callback.providerConnectionRef}` } });
    await tx.consentEvent.create({ data: { consentId: consent.id, event: "CONSENT_GRANTED", actor: "PROVIDER" } });
    for (const account of callback.accounts) {
      await tx.externalFinancialAccount.upsert({
        where: {
          connectionId_providerAccountRef: {
            connectionId: connection.id, providerAccountRef: account.providerAccountRef,
          },
        },
        create: {
          connectionId: connection.id,
          userId: connection.userId,
          providerAccountRef: account.providerAccountRef,
          accountType: account.accountType,
          institutionName: account.institutionName,
          maskedIdentifier: account.maskedIdentifier,
          encryptedAccountRef: encryptSecret(account.secretReference),
          currency: account.currency,
        },
        update: { status: "ACTIVE" },
      });
    }
    // Enqueue the initial synchronisation; it is not executed inline.
    await tx.accountSyncJob.create({
      data: { connectionId: connection.id, userId: connection.userId, kind: "FULL_SYNC", status: "PENDING" },
    });
    await tx.accountSyncJob.create({
      data: { connectionId: connection.id, userId: connection.userId, kind: "BALANCE_REFRESH", status: "PENDING" },
    });
    await tx.externalAccountConnection.update({ where: { id: connection.id }, data: { status: "SYNC_PENDING" } });
    await tx.dataAccessAuditEvent.create({
      data: {
        userId: connection.userId, actorType: "PROVIDER", actorId: provider.code,
        action: "EXTERNAL_CALLBACK_VERIFIED", targetType: "connection", targetId: connection.id,
      },
    });
  });

  await prisma.providerCallbackEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", processedAt: new Date() } });
  await createNotification(prisma, {
    userId: connection.userId,
    type: "EXTERNAL_ACCOUNT_CONNECTED",
    title: "External account connected",
    body: `${provider.displayName} is connected. Synchronisation is queued.${provider.mode === "SANDBOX" ? " Sandbox test data only." : ""}`,
    data: { connectionId: connection.id },
  });
  return { connectionId: connection.id, status: "SYNC_PENDING" };
}

export async function listConnections(userId: string): Promise<ConnectionView[]> {
  const rows = await prisma.externalAccountConnection.findMany({
    where: { userId }, include: { provider: true, accounts: true, consents: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    providerName: row.provider.displayName,
    status: row.status,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
    accountCount: row.accounts.length,
    activeConsentId: row.consents.find((consent) => consent.status === "ACTIVE")?.id ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function ownedConnection(userId: string, id: string) {
  const connection = await prisma.externalAccountConnection.findFirst({ where: { id, userId } });
  if (!connection) throw new ApiError(404, "AUTHORIZATION_ERROR", "Connection not found.");
  return connection;
}

export async function disconnectConnection(userId: string, id: string): Promise<{ id: string; status: string }> {
  const connection = await ownedConnection(userId, id);
  if (connection.status === "REVOKED") return { id, status: "REVOKED" };
  // Disconnection is always permitted from any active state.
  await prisma.$transaction(async (tx) => {
    await tx.externalAccountConnection.update({ where: { id }, data: { status: "REVOKED" } });
    await tx.externalAccountConsent.updateMany({ where: { connectionId: id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
    await tx.accountSyncJob.updateMany({ where: { connectionId: id, status: "PENDING" }, data: { status: "FAILED", error: "Connection revoked" } });
    const consent = await tx.externalAccountConsent.findFirst({ where: { connectionId: id }, orderBy: { createdAt: "desc" } });
    if (consent) await tx.consentEvent.create({ data: { consentId: consent.id, event: "CONNECTION_DISCONNECTED", actor: userId } });
    await tx.dataAccessAuditEvent.create({
      data: { userId, actorType: "USER", actorId: userId, action: "EXTERNAL_CONNECTION_DISCONNECTED", targetType: "connection", targetId: id },
    });
  });
  await createNotification(prisma, {
    userId, type: "EXTERNAL_ACCOUNT_DISCONNECTED", title: "External account disconnected",
    body: "Future data retrieval has stopped.", data: { connectionId: id },
  });
  return { id, status: "REVOKED" };
}

export async function getConsent(userId: string, id: string): Promise<ConsentView> {
  const consent = await prisma.externalAccountConsent.findFirst({
    where: { id, userId }, include: { events: true, connection: { include: { provider: true } } },
  });
  if (!consent) throw new ApiError(404, "AUTHORIZATION_ERROR", "Consent record not found.");
  return {
    id: consent.id, connectionId: consent.connectionId,
    providerName: consent.connection.provider.displayName, status: consent.status,
    purpose: consent.purpose, dataCategories: consent.dataCategories,
    periodFrom: consent.periodFrom.toISOString(), periodTo: consent.periodTo.toISOString(),
    createdAt: consent.createdAt.toISOString(), expiresAt: consent.expiresAt.toISOString(),
    revokedAt: consent.revokedAt?.toISOString() ?? null,
    events: consent.events.map((event) => ({ event: event.event, actor: event.actor, at: event.createdAt.toISOString() })),
  };
}

export async function listConsents(userId: string): Promise<ConsentView[]> {
  const rows = await prisma.externalAccountConsent.findMany({
    where: { userId }, include: { events: true, connection: { include: { provider: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((consent) => ({
    id: consent.id, connectionId: consent.connectionId,
    providerName: consent.connection.provider.displayName, status: consent.status,
    purpose: consent.purpose, dataCategories: consent.dataCategories,
    periodFrom: consent.periodFrom.toISOString(), periodTo: consent.periodTo.toISOString(),
    createdAt: consent.createdAt.toISOString(), expiresAt: consent.expiresAt.toISOString(),
    revokedAt: consent.revokedAt?.toISOString() ?? null,
    events: consent.events.map((event) => ({ event: event.event, actor: event.actor, at: event.createdAt.toISOString() })),
  }));
}

export async function revokeConsent(userId: string, id: string, reason?: string): Promise<ConsentView> {
  const consent = await prisma.externalAccountConsent.findFirst({ where: { id, userId } });
  if (!consent) throw new ApiError(404, "AUTHORIZATION_ERROR", "Consent record not found.");
  if (consent.status === "REVOKED") return getConsent(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.externalAccountConsent.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await tx.consentEvent.create({ data: { consentId: id, event: "CONSENT_REVOKED", actor: userId, metadata: { reason: reason ?? null } } });
    await tx.externalAccountConnection.update({ where: { id: consent.connectionId }, data: { status: "REVOKED" } });
    await tx.accountSyncJob.updateMany({
      where: { connectionId: consent.connectionId, status: "PENDING" },
      data: { status: "FAILED", error: "Consent revoked" },
    });
    await tx.dataAccessAuditEvent.create({
      data: { userId, actorType: "USER", actorId: userId, action: "EXTERNAL_CONSENT_REVOKED", targetType: "consent", targetId: id, metadata: { reason: reason ?? null } },
    });
  });
  return getConsent(userId, id);
}

export async function renewConsent(userId: string, id: string, durationDays = 90): Promise<ConsentView> {
  const consent = await prisma.externalAccountConsent.findFirst({ where: { id, userId } });
  if (!consent) throw new ApiError(404, "AUTHORIZATION_ERROR", "Consent record not found.");
  if (!["ACTIVE", "EXPIRED"].includes(consent.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "Only active or expired consents can be renewed.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.externalAccountConsent.update({
      where: { id },
      data: { status: "ACTIVE", expiresAt: new Date(Date.now() + durationDays * 86_400_000), revokedAt: null },
    });
    await tx.consentEvent.create({ data: { consentId: id, event: "CONSENT_RENEWED", actor: userId } });
  });
  return getConsent(userId, id);
}

export { SANDBOX_NOTICE };
