/**
 * Release 20 — versioned privacy consent, durable data export and deletion
 * request workflows. No authoritative financial record is modified or erased.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import {
  PRIVACY_PURPOSES,
  type ConsentStatus,
  type DataDeletionView,
  type DataExportView,
  type DeletionStatus,
  type ExportStatus,
  type PrivacyConsentView,
} from "@nexus/shared-types";
import {
  notifyIdentity, publishIdentityEvent, recordAdminSecurityAction,
} from "@/lib/identity/identity-audit";

const EXPORT_DIR = path.join(process.cwd(), ".security-exports");
const LINK_TTL_MS = 5 * 60 * 1000;

export const RETENTION_NOTICE =
  "Records required for security, fraud prevention, accounting, reconciliation and legal obligations are retained under documented policies. Deletion requests do not alter Raftline ledger entries or committed financial records. Backups and third-party systems are not immediately erased.";

function exportToken(id: string, expiresAt: number): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(`security-export:${id}:${expiresAt}`)
    .digest("hex");
}

export async function ensureDefaultConsents(userId: string) {
  for (const purpose of PRIVACY_PURPOSES.filter((item) => item.required)) {
    const existing = await prisma.privacyConsent.findFirst({
      where: { userId, purpose: purpose.code }, orderBy: { createdAt: "desc" },
    });
    if (!existing) {
      await prisma.privacyConsent.create({
        data: {
          userId, purpose: purpose.code, version: purpose.version,
          status: "GRANTED", source: "REQUIRED_FOR_SERVICE",
          dataCategories: ["ACCOUNT", "TRANSACTION_METADATA"],
        },
      });
    }
  }
}

export async function listConsents(userId: string): Promise<PrivacyConsentView[]> {
  await ensureDefaultConsents(userId);
  const rows = await prisma.privacyConsent.findMany({
    where: { userId }, orderBy: [{ purpose: "asc" }, { createdAt: "desc" }],
  });
  const seen = new Set<string>();
  const views: PrivacyConsentView[] = [];
  for (const row of rows) {
    if (seen.has(row.purpose)) continue;
    seen.add(row.purpose);
    const definition = PRIVACY_PURPOSES.find((item) => item.code === row.purpose);
    views.push({
      id: row.id,
      purpose: row.purpose,
      label: definition?.label ?? row.purpose,
      version: row.version,
      status: row.status as ConsentStatus,
      source: row.source,
      dataCategories: (row.dataCategories as string[]) ?? [],
      grantedAt: row.grantedAt.toISOString(),
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      required: Boolean(definition?.required),
    });
  }
  return views;
}

export async function updateConsent(userId: string, input: {
  purpose: string; version: string; granted: boolean; source?: string;
}) {
  const definition = PRIVACY_PURPOSES.find((item) => item.code === input.purpose);
  if (!definition) throw new ApiError(400, "VALIDATION_ERROR", "Unknown privacy purpose");
  if (definition.required && !input.granted) {
    throw new ApiError(409, "VALIDATION_ERROR", "This processing purpose is required to provide your account.");
  }
  const status: ConsentStatus = input.granted ? "GRANTED" : "WITHDRAWN";
  const row = await prisma.privacyConsent.create({
    data: {
      userId, purpose: input.purpose, version: input.version, status,
      source: input.source ?? "SECURITY_CENTRE",
      dataCategories: [...definition.label.matchAll(/\w+/g)].length
        ? ["ACCOUNT"]
        : [],
      withdrawnAt: input.granted ? null : new Date(),
    },
  });
  await prisma.privacyConsentEvent.create({
    data: {
      consentId: row.id, userId, action: input.granted ? "CONSENT_GRANTED" : "CONSENT_WITHDRAWN",
      actor: userId, source: row.source,
      metadata: { purpose: input.purpose, version: input.version },
    },
  });
  // Withdrawal stops future processing where the integration supports it.
  if (!input.granted && input.purpose === "EXTERNAL_ACCOUNT_AGGREGATION") {
    const active = await prisma.externalAccountConnection.findMany({
      where: { userId, status: "ACTIVE" }, select: { id: true },
    });
    const { revokeConsent } = await import("@/lib/accounts/connections-service");
    for (const connection of active) {
      await revokeConsent(userId, connection.id, "Privacy consent withdrawn");
    }
  }
  await publishIdentityEvent({ type: "PRIVACY_CONSENT_UPDATED", userId, metadata: { purpose: input.purpose, status } });
  await notifyIdentity({
    userId, eventKey: `security:consent:${row.id}`, type: "SECURITY_PRIVACY_UPDATED",
    title: "Privacy preference updated", body: `Your ${definition.label.toLowerCase()} preference was updated.`,
  });
  return { id: row.id, status };
}

function exportView(row: {
  id: string; status: string; format: string; fileName: string | null;
  createdAt: Date; completedAt: Date | null; expiresAt: Date | null;
}): DataExportView {
  return {
    id: row.id, status: row.status as ExportStatus, format: row.format,
    fileName: row.fileName, createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export async function requestDataExport(userId: string, input: {
  format?: string; idempotencyKey: string;
}) {
  const existing = await prisma.dataExportRequest.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (existing.userId !== userId) throw new ApiError(404, "VALIDATION_ERROR", "Export not found");
    return exportView(existing);
  }
  const row = await prisma.dataExportRequest.create({
    data: {
      userId, format: input.format ?? "JSON", status: "REQUESTED",
      idempotencyKey: input.idempotencyKey,
    },
  });
  await prisma.securityJob.create({
    data: {
      kind: "EXPORT_GENERATE", payload: { exportId: row.id },
      idempotencyKey: `export:${row.id}`,
      status: "PENDING", nextAttemptAt: new Date(),
    },
  });
  await publishIdentityEvent({ type: "DATA_EXPORT_REQUESTED", userId, metadata: { exportId: row.id } });
  return exportView(row);
}

export async function listExports(userId: string): Promise<DataExportView[]> {
  const rows = await prisma.dataExportRequest.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return rows.map(exportView);
}

async function ownedExport(userId: string, id: string) {
  const row = await prisma.dataExportRequest.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Export not found");
  return row;
}

export async function getExportLink(userId: string, id: string) {
  const row = await ownedExport(userId, id);
  if (row.status !== "READY" || !row.expiresAt || row.expiresAt <= new Date()) {
    throw new ApiError(409, "VALIDATION_ERROR", "Export is not available or has expired");
  }
  const expiresAt = Date.now() + LINK_TTL_MS;
  const token = exportToken(row.id, expiresAt);
  return `/api/security/data/exports/${row.id}/download?token=${token}&expiresAt=${expiresAt}`;
}

export async function downloadExport(userId: string, id: string, token: string, expiresAtRaw: string) {
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new ApiError(401, "AUTHENTICATION_ERROR", "Export link expired");
  }
  const expected = exportToken(id, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, "AUTHENTICATION_ERROR", "Invalid export link");
  }
  const row = await ownedExport(userId, id);
  if (row.status !== "READY" || !row.storagePath || !row.expiresAt || row.expiresAt <= new Date()) {
    throw new ApiError(409, "VALIDATION_ERROR", "Export is not available or has expired");
  }
  const bytes = Buffer.from(decryptSecret(await fs.readFile(row.storagePath, "utf8")), "base64");
  await publishIdentityEvent({ type: "DATA_EXPORT_READY", userId, metadata: { exportId: row.id, action: "DOWNLOADED" } });
  return { bytes, fileName: row.fileName ?? `nexus-pay-export-${row.id}.json` };
}

/** Worker handler: generates an access-controlled JSON export. Contents are never logged. */
export async function generateExport(exportId: string) {
  const row = await prisma.dataExportRequest.findUnique({ where: { id: exportId } });
  if (!row || row.status !== "REQUESTED") return;
  const [user, profile, sessions, authMethods, consents, transactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, fullName: true, email: true, username: true, createdAt: true, lastLoginAt: true },
    }),
    prisma.userProfile.findUnique({ where: { userId: row.userId }, select: { displayName: true, preferredCurrency: true, preferredLanguage: true } }),
    prisma.userSession.findMany({
      where: { userId: row.userId }, select: { createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" }, take: 200,
    }),
    prisma.authMethod.findMany({
      where: { userId: row.userId }, select: { type: true, status: true, createdAt: true, verifiedAt: true },
    }),
    prisma.privacyConsent.findMany({
      where: { userId: row.userId }, select: { purpose: true, version: true, status: true, source: true, grantedAt: true },
    }),
    prisma.transactionRecord.findMany({
      where: { userId: row.userId }, select: { amountMinor: true, currency: true, status: true, occurredAt: true },
      orderBy: { occurredAt: "desc" }, take: 500,
    }),
  ]);
  const payload = {
    generatedAt: new Date().toISOString(),
    notice: RETENTION_NOTICE,
    account: user,
    profile,
    sessions,
    authenticationMethods: authMethods,
    privacyConsents: consents,
    recentTransactions: transactions.map((tx) => ({
      amountMinor: Number(tx.amountMinor), currency: tx.currency, status: tx.status, occurredAt: tx.occurredAt,
    })),
  };
  const directory = path.join(EXPORT_DIR, row.userId);
  await fs.mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, `${row.id}.enc`);
  const fileName = `nexus-pay-export-${row.id}.json`;
  await fs.writeFile(storagePath, encryptSecret(Buffer.from(JSON.stringify(payload)).toString("base64")), { mode: 0o600 });
  const ttl = getServerEnv().NEXUS_SECURITY_EXPORT_TTL_HOURS;
  await prisma.dataExportRequest.update({
    where: { id: row.id },
    data: {
      status: "READY", storagePath, fileName, completedAt: new Date(),
      sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      expiresAt: new Date(Date.now() + ttl * 3600_000),
    },
  });
  await publishIdentityEvent({ type: "DATA_EXPORT_READY", userId: row.userId, metadata: { exportId: row.id } });
  await notifyIdentity({
    userId: row.userId, eventKey: `security:export-ready:${row.id}`, type: "SECURITY_DATA_EXPORT_READY",
    title: "Your data export is ready", body: "A signed, expiring download link is available in the Security Centre.",
  });
}

function deletionView(row: {
  id: string; status: string; reason: string; createdAt: Date;
  reviewedBy: string | null; completedAt: Date | null;
}): DataDeletionView {
  return {
    id: row.id, status: row.status as DeletionStatus, reason: row.reason,
    createdAt: row.createdAt.toISOString(), reviewedBy: row.reviewedBy,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function requestDataDeletion(userId: string, input: {
  reason: string; confirmation: string; idempotencyKey: string;
}) {
  if (input.confirmation !== "DELETE_MY_ACCOUNT_DATA") {
    throw new ApiError(400, "VALIDATION_ERROR", "Confirmation is required");
  }
  const existing = await prisma.dataDeletionRequest.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (existing.userId !== userId) throw new ApiError(404, "VALIDATION_ERROR", "Request not found");
    return deletionView(existing);
  }
  const row = await prisma.dataDeletionRequest.create({
    data: { userId, reason: input.reason, idempotencyKey: input.idempotencyKey },
  });
  await publishIdentityEvent({ type: "DATA_DELETION_REQUESTED", userId, metadata: { requestId: row.id } });
  return deletionView(row);
}

export async function listDeletions(userId: string): Promise<DataDeletionView[]> {
  const rows = await prisma.dataDeletionRequest.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return rows.map(deletionView);
}

export async function adminReviewDeletion(
  actorId: string, id: string, decision: "APPROVED" | "REJECTED", reason: string,
) {
  const row = await prisma.dataDeletionRequest.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Deletion request not found");
  const status: DeletionStatus = decision === "APPROVED" ? "APPROVED" : "REJECTED";
  await prisma.dataDeletionRequest.update({
    where: { id }, data: { status, reviewedBy: actorId, ...(decision === "REJECTED" ? { reviewNote: reason } : {}) },
  });
  await publishIdentityEvent({ type: "DATA_DELETION_REVIEWED", userId: row.userId, actorId, metadata: { decision } });
  await recordAdminSecurityAction({
    actorId, action: "DATA_DELETION_REVIEWED", targetType: "DATA_DELETION_REQUEST",
    targetId: id, reason, metadata: { decision },
  });
  return deletionView(await prisma.dataDeletionRequest.findUniqueOrThrow({ where: { id } }));
}
