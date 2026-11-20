/**
 * Release 18 — international payment state machine (provider-ready, UNAVAILABLE).
 *
 * Financial invariants:
 *  - No wallet debit occurs here. Raftline remains authoritative for INR wallet.
 *  - A provider confirmation is stored separately from wallet settlement.
 *  - Unknown outcomes are reconciled by the ORIGINAL provider reference.
 *  - No blind retry and no duplicate transfer idempotency key on timeout.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import type {
  BeneficiaryView, ComplianceState, CorridorView, InternationalProviderView,
  InternationalTransferView, TransferState,
} from "@nexus/shared-types";
import { encryptSecret } from "@/lib/security/crypto";
import { notifyGlobal, recordGlobalAudit, publishGlobalSecurity } from "@/lib/global/global-audit";
import {
  ensureInternationalRecords, getInternationalAdapter,
  listInternationalProviders, INTERNATIONAL_ONBOARDING_PREREQUISITES,
} from "@/lib/global/providers/international-index";

const TRANSFER_NOTICE =
  "International transfers require a verified, authorized provider. No provider is enabled, so no transfer has been submitted and no wallet debit was made.";

function mask(identifier: string): string {
  const clean = identifier.trim();
  if (clean.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, clean.length - 4))}${clean.slice(-4)}`;
}

export async function listProviders(): Promise<InternationalProviderView[]> {
  await ensureInternationalRecords();
  return listInternationalProviders();
}

export async function listCorridors(): Promise<CorridorView[]> {
  await ensureInternationalRecords();
  const rows = await prisma.corridorConfiguration.findMany({ orderBy: { destinationCountry: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    sourceCountry: row.sourceCountry,
    destinationCountry: row.destinationCountry,
    sourceCurrency: row.sourceCurrency,
    targetCurrency: row.targetCurrency,
    enabled: row.enabled,
    providerCode: row.providerCode,
    notice: row.notice ?? "No authorized corridor is configured.",
  }));
}

function beneficiaryView(row: {
  id: string; label: string; country: string; currency: string; bankName: string | null;
  accountMasked: string; paymentMethod: string; providerRef: string | null;
  verificationStatus: string; createdAt: Date;
}): BeneficiaryView {
  return {
    id: row.id, label: row.label, country: row.country, currency: row.currency,
    bankName: row.bankName, accountMasked: row.accountMasked, paymentMethod: row.paymentMethod,
    providerRef: row.providerRef, verificationStatus: row.verificationStatus as ComplianceState,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listBeneficiaries(userId: string): Promise<BeneficiaryView[]> {
  const rows = await prisma.internationalBeneficiary.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(beneficiaryView);
}

export async function createBeneficiary(userId: string, input: {
  label: string; country: string; currency: string; bankName?: string;
  accountIdentifier: string; routingInformation?: string; paymentMethod: string;
}) {
  const encryptedDetails = encryptSecret(JSON.stringify({
    accountIdentifier: input.accountIdentifier,
    routingInformation: input.routingInformation ?? null,
  }));
  const row = await prisma.internationalBeneficiary.create({
    data: {
      userId,
      label: input.label,
      country: input.country.toUpperCase(),
      currency: input.currency.toUpperCase(),
      bankName: input.bankName ?? null,
      encryptedDetails,
      accountMasked: mask(input.accountIdentifier),
      paymentMethod: input.paymentMethod,
      verificationStatus: "VERIFICATION_PENDING",
    },
  });
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "BENEFICIARY_CREATED", targetType: "INTERNATIONAL_BENEFICIARY", targetId: row.id });
  await publishGlobalSecurity({ type: "GLOBAL_BENEFICIARY_CREATED", actorId: userId, subjectId: userId, metadata: { beneficiaryId: row.id } });
  return beneficiaryView(row);
}

export async function getBeneficiary(userId: string, id: string): Promise<BeneficiaryView> {
  const row = await prisma.internationalBeneficiary.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Beneficiary not found");
  await publishGlobalSecurity({ type: "GLOBAL_BENEFICIARY_ACCESSED", actorId: userId, subjectId: userId, metadata: { beneficiaryId: id } });
  return beneficiaryView(row);
}

function transferView(row: {
  id: string; state: string; beneficiaryId: string; sourceCurrency: string; targetCurrency: string;
  sourceMinor: bigint; targetMinor: bigint | null; feeMinor: bigint | null; providerCode: string;
  providerRef: string | null; complianceState: string; walletSettlementRef: string | null;
  failureReason: string | null; createdAt: Date; updatedAt: Date;
}): InternationalTransferView {
  return {
    id: row.id,
    state: row.state as TransferState,
    beneficiaryId: row.beneficiaryId,
    sourceCurrency: row.sourceCurrency,
    targetCurrency: row.targetCurrency,
    sourceMinor: Number(row.sourceMinor),
    targetMinor: row.targetMinor == null ? null : Number(row.targetMinor),
    feeMinor: row.feeMinor == null ? null : Number(row.feeMinor),
    providerCode: row.providerCode,
    providerRef: row.providerRef,
    complianceState: row.complianceState as ComplianceState,
    walletSettlementRef: row.walletSettlementRef,
    notice: row.failureReason ? `${TRANSFER_NOTICE} ${row.failureReason}` : TRANSFER_NOTICE,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function appendEvent(transferId: string, state: string, detail: string | null, providerRef: string | null = null) {
  await prisma.internationalTransferEvent.create({
    data: { transferId, state, detail, providerRef },
  });
}

/**
 * Creates a transfer RECORD only. It never debits a wallet and never contacts a
 * payment network. The idempotency key is unique so a timeout cannot create a
 * second transfer record.
 */
export async function createTransfer(userId: string, input: {
  beneficiaryId: string; sourceCurrency: string; targetCurrency: string; sourceMinor: number;
  purposeCode: string; providerCode?: string; idempotencyKey: string;
}) {
  const beneficiary = await prisma.internationalBeneficiary.findFirst({ where: { id: input.beneficiaryId, userId } });
  if (!beneficiary) throw new ApiError(404, "VALIDATION_ERROR", "Beneficiary not found");
  if (beneficiary.currency !== input.targetCurrency.toUpperCase()) {
    throw new ApiError(400, "VALIDATION_ERROR", "Beneficiary currency does not match the target currency");
  }
  if (input.sourceCurrency.toUpperCase() !== "INR") {
    throw new ApiError(400, "VALIDATION_ERROR", "Outward remittance sources are INR wallets only");
  }

  const providerCode = input.providerCode ?? "sandbox-intl";
  const adapter = getInternationalAdapter(providerCode);
  const corridor = await prisma.corridorConfiguration.findFirst({
    where: {
      providerCode,
      sourceCurrency: input.sourceCurrency.toUpperCase(),
      targetCurrency: input.targetCurrency.toUpperCase(),
      enabled: true,
    },
  });
  if (!corridor || !adapter.capabilities.transfers) {
    // No authorized corridor/capability: persist a clearly non-executed record.
    const existing = await prisma.internationalTransfer.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing && existing.userId === userId) return transferView(existing);
    const row = await prisma.internationalTransfer.create({
      data: {
        userId,
        state: "CREATED",
        beneficiaryId: input.beneficiaryId,
        sourceCurrency: input.sourceCurrency.toUpperCase(),
        targetCurrency: input.targetCurrency.toUpperCase(),
        sourceMinor: BigInt(input.sourceMinor),
        providerCode,
        purposeCode: input.purposeCode,
        idempotencyKey: input.idempotencyKey,
        complianceState: "INFORMATION_REQUIRED",
        failureReason: `Transfer not submitted. No enabled, authorized corridor for ${input.sourceCurrency}/${input.targetCurrency}. ${TRANSFER_NOTICE}`,
      },
    });
    await appendEvent(row.id, "CREATED", row.failureReason);
    await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "TRANSFER_PREVIEW_CREATED", targetType: "INTERNATIONAL_TRANSFER", targetId: row.id });
    await publishGlobalSecurity({ type: "GLOBAL_TRANSFER_CREATED", actorId: userId, subjectId: userId, transactionRef: input.idempotencyKey, metadata: { transferId: row.id, executed: false } });
    return transferView(row);
  }

  // This branch is unreachable with the shipped sandbox adapter (transfers=false).
  // It is reserved for a verified production adapter and is intentionally inert.
  throw new ApiError(
    503,
    "RAFTLINE_UNAVAILABLE",
    `Executable transfers are disabled. ${INTERNATIONAL_ONBOARDING_PREREQUISITES.join(" ")}`,
  );
}

export async function getTransfer(userId: string, id: string): Promise<InternationalTransferView> {
  const row = await prisma.internationalTransfer.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Transfer not found");
  return transferView(row);
}

export async function listTransfers(userId: string, limit = 50): Promise<InternationalTransferView[]> {
  const rows = await prisma.internationalTransfer.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(transferView);
}

export async function recordComplianceCheck(input: {
  userId: string; transferId?: string; kind: string; state: ComplianceState;
  providerRef?: string; detail?: string;
}) {
  const row = await prisma.internationalComplianceCheck.create({
    data: {
      userId: input.userId,
      transferId: input.transferId ?? null,
      kind: input.kind,
      state: input.state,
      providerRef: input.providerRef ?? null,
      detail: input.detail ?? null,
    },
  });
  await publishGlobalSecurity({ type: "GLOBAL_COMPLIANCE_STATE_CHANGED", actorId: input.userId, subjectId: input.userId, metadata: { checkId: row.id, state: input.state } });
  return row.id;
}

/** Verifies an HMAC signature and de-duplicates by provider + event id. */
export function verifyWebhookSignature(providerCode: string, eventId: string, payload: string, signature: string): boolean {
  const secret = process.env.AUTH_SECRET ?? "";
  const expected = createHmac("sha256", `${secret}:intl-webhook:${providerCode}`)
    .update(`${eventId}.${payload}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function receiveInternationalWebhook(input: {
  providerCode: string; eventId: string; payload: object; signature: string;
}) {
  const raw = JSON.stringify(input.payload);
  const verified = verifyWebhookSignature(input.providerCode, input.eventId, raw, input.signature);
  if (!verified) {
    await publishGlobalSecurity({ type: "PROVIDER_WEBHOOK_RECEIVED", metadata: { providerCode: input.providerCode, verified: false } });
    throw new ApiError(401, "AUTHENTICATION_ERROR", "Invalid webhook signature");
  }
  const existing = await prisma.internationalPaymentWebhook.findUnique({
    where: { providerCode_eventId: { providerCode: input.providerCode, eventId: input.eventId } },
  });
  if (existing) return { duplicate: true, id: existing.id }; // idempotent replay
  const row = await prisma.internationalPaymentWebhook.create({
    data: {
      providerCode: input.providerCode,
      eventId: input.eventId,
      payload: input.payload as object,
      signatureVerified: true,
      processed: false,
    },
  });
  return { duplicate: false, id: row.id };
}

/**
 * Control reconciliation. Resolves an UNKNOWN outcome using the ORIGINAL
 * provider reference. It never marks COMPLETED without provider confirmation and
 * never moves money.
 */
export async function reconcileTransfer(input: {
  actorId: string; transferId: string; providerRef: string;
  outcome: "CONFIRMED" | "NOT_RECEIVED" | "UNRESOLVED"; detail?: string;
}) {
  const transfer = await prisma.internationalTransfer.findUnique({ where: { id: input.transferId } });
  if (!transfer) throw new ApiError(404, "VALIDATION_ERROR", "Transfer not found");
  if (transfer.providerRef && transfer.providerRef !== input.providerRef) {
    throw new ApiError(409, "VALIDATION_ERROR", "Provider reference does not match the original transfer");
  }
  const state: TransferState = input.outcome === "CONFIRMED" ? "COMPLETED"
    : input.outcome === "NOT_RECEIVED" ? "FAILED" : "RECONCILIATION_REQUIRED";
  const record = await prisma.internationalReconciliation.create({
    data: {
      transferId: transfer.id,
      providerRef: input.providerRef,
      outcome: input.outcome,
      detail: input.detail ?? null,
      resolvedBy: input.actorId,
    },
  });
  await prisma.internationalTransfer.update({
    where: { id: transfer.id },
    data: { state, providerRef: input.providerRef },
  });
  await appendEvent(transfer.id, state, `Reconciled by ${input.actorId}: ${input.outcome}`, input.providerRef);
  await recordGlobalAudit({ actorType: "ADMIN", actorId: input.actorId, action: "TRANSFER_RECONCILED", targetType: "INTERNATIONAL_TRANSFER", targetId: transfer.id, metadata: { outcome: input.outcome, providerRef: input.providerRef } });
  await publishGlobalSecurity({ type: "GLOBAL_RECONCILIATION_RESOLVED", actorId: input.actorId, subjectId: transfer.userId, transactionRef: input.providerRef });
  if (state === "RECONCILIATION_REQUIRED") {
    await notifyGlobal(transfer.userId, "GLOBAL_TRANSFER_RECONCILIATION_REQUIRED", "International transfer needs review", input.detail ?? null, { transferId: transfer.id });
  }
  return record;
}
