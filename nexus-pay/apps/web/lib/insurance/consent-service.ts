import { prisma } from "@nexus/database";
import type { InsuranceConsentView } from "@nexus/shared-types";
import type { InsuranceConsentInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";

export async function createConsent(userId: string, input: InsuranceConsentInput): Promise<InsuranceConsentView> {
  const provider = await prisma.insuranceProvider.findUnique({ where: { id: input.providerId } });
  if (!provider) throw new ApiError(404, "AUTHORIZATION_ERROR", "Insurer not found.");
  const row = await prisma.insuranceConsent.create({
    data: {
      userId,
      providerId: input.providerId,
      purpose: input.purpose,
      dataCategories: [...input.dataCategories],
      sharedFields: [...input.sharedFields],
      version: input.version,
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    },
  });
  return view(row);
}

export async function listConsents(userId: string): Promise<InsuranceConsentView[]> {
  const rows = await prisma.insuranceConsent.findMany({
    where: { userId }, include: { provider: true }, orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map(view);
}

export async function revokeConsent(userId: string, id: string): Promise<InsuranceConsentView> {
  const row = await prisma.insuranceConsent.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Consent not found.");
  if (row.status === "REVOKED") return view(row);
  await prisma.insuranceConsent.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
  await prisma.dataAccessAuditEvent.create({
    data: {
      userId, actorType: "USER", actorId: userId, action: "INSURANCE_CONSENT_REVOKED",
      targetType: "insurance_consent", targetId: id,
    },
  });
  return view(row);
}

/** Providers must never be queried with a revoked or expired consent. */
export async function requireActiveConsent(userId: string, providerId: string): Promise<void> {
  const consent = await prisma.insuranceConsent.findFirst({
    where: { userId, providerId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!consent || (consent.expiresAt && consent.expiresAt <= new Date())) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "No active consent for this insurer.");
  }
}

function view(row: {
  id: string; providerId: string; purpose: string; dataCategories: string[];
  sharedFields: unknown; version: string; status: string; createdAt: Date; revokedAt: Date | null;
  provider?: { displayName: string };
}): InsuranceConsentView {
  return {
    id: row.id,
    providerName: row.provider?.displayName ?? row.providerId,
    purpose: row.purpose,
    dataCategories: row.dataCategories,
    sharedFields: (row.sharedFields as string[] | null) ?? [],
    version: row.version,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
