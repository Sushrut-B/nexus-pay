import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@nexus/database";
import type { TaxDocumentView, TaxReconciliationView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { securityAudit } from "@/lib/fraud/audit-service";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { enqueueTaxJob } from "@/lib/tax/tax-worker-service";

const DOC_DIR = path.join(process.cwd(), ".tax-documents");
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "text/csv"]);
const MAX_BYTES = 5 * 1024 * 1024;

function view(row: {
  id: string; financialYear: string; kind: string; fileName: string; contentType: string;
  sizeBytes: number; status: string; createdAt: Date; extractions?: unknown[];
}): TaxDocumentView {
  return {
    id: row.id, financialYear: row.financialYear, kind: row.kind, fileName: row.fileName,
    contentType: row.contentType, sizeBytes: row.sizeBytes, status: row.status,
    extractedFields: row.extractions?.length ?? 0, createdAt: row.createdAt.toISOString(),
  };
}

export async function listDocuments(userId: string, financialYear?: string) {
  const rows = await prisma.taxDocument.findMany({
    where: { userId, ...(financialYear ? { financialYear } : {}), status: { not: "DELETED" } },
    include: { extractions: true }, orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map(view);
}

async function owned(userId: string, id: string) {
  const row = await prisma.taxDocument.findFirst({ where: { id, userId, status: { not: "DELETED" } } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Tax document not found.");
  return row;
}

export async function uploadDocument(userId: string, file: { bytes: Buffer; fileName: string; contentType: string }, input: { financialYear: string; kind: string }) {
  if (!ALLOWED.has(file.contentType)) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported document type.");
  if (file.bytes.length === 0 || file.bytes.length > MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Document must be between 1 byte and 5 MB.");
  }
  const fingerprint = createHash("sha256").update(file.bytes).digest("hex");
  const duplicateRow = await prisma.taxDocument.findFirst({
    where: { userId, providerRef: fingerprint, status: { not: "DELETED" } },
  });
  const row = await prisma.taxDocument.create({
    data: {
      userId, financialYear: input.financialYear, kind: input.kind,
      fileName: file.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120),
      contentType: file.contentType, sizeBytes: file.bytes.length, status: "PENDING",
      providerRef: fingerprint,
      ...(duplicateRow ? { duplicateOf: duplicateRow.id } : {}),
    },
  });
  try {
    const dir = path.join(DOC_DIR, userId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${row.id}.enc`);
    await writeFile(filePath, encryptSecret(file.bytes.toString("base64")), "utf8");
    await prisma.taxDocument.update({ where: { id: row.id }, data: { storagePath: filePath, status: "READY" } });
    await prisma.taxDocumentAccessLog.create({ data: { documentId: row.id, userId, action: "UPLOADED" } });
    await securityAudit({ actorType: "USER", actorId: userId, action: "TAX_DOCUMENT_UPLOADED", targetType: "tax_document", targetId: row.id });
    await enqueueTaxJob(userId, "DOCUMENT_EXTRACTION", { documentId: row.id });
    return view(row);
  } catch (error) {
    await prisma.taxDocument.update({ where: { id: row.id }, data: { status: "FAILED" } });
    throw error;
  }
}

export function documentToken(documentId: string, expiresAt: number) {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${documentId}:${expiresAt}`).digest("hex");
}

export async function getDocumentLink(userId: string, id: string) {
  const row = await owned(userId, id);
  if (!row.storagePath) throw new ApiError(409, "PAYMENT_ERROR", "Document is not ready.");
  const expiresAt = Date.now() + 5 * 60_000;
  await prisma.taxDocumentAccessLog.create({ data: { documentId: id, userId, action: "ACCESS_GRANTED" } });
  await securityAudit({ actorType: "USER", actorId: userId, action: "TAX_DOCUMENT_ACCESS_GRANTED", targetType: "tax_document", targetId: id });
  return { token: documentToken(id, expiresAt), expiresAt, fileName: row.fileName };
}

export async function downloadDocument(userId: string, id: string, token: string, expiresAt: number) {
  const row = await owned(userId, id);
  if (!row.storagePath) throw new ApiError(404, "AUTHORIZATION_ERROR", "Document not found.");
  if (expiresAt <= Date.now() || token !== documentToken(id, expiresAt)) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Download link is invalid or expired.");
  }
  const buffer = Buffer.from(decryptSecret(await readFile(row.storagePath, "utf8")), "base64");
  await prisma.taxDocumentAccessLog.create({ data: { documentId: id, userId, action: "DOWNLOADED" } });
  await securityAudit({ actorType: "USER", actorId: userId, action: "TAX_DOCUMENT_DOWNLOADED", targetType: "tax_document", targetId: id });
  return { buffer, contentType: row.contentType, fileName: row.fileName };
}

export async function deleteDocument(userId: string, id: string) {
  const row = await owned(userId, id);
  if (row.storagePath) await unlink(row.storagePath).catch(() => undefined);
  await prisma.taxDocument.update({ where: { id }, data: { status: "DELETED", storagePath: null } });
  await securityAudit({ actorType: "USER", actorId: userId, action: "TAX_DOCUMENT_DELETED", targetType: "tax_document", targetId: id });
  return { id, deleted: true };
}

/** Extraction is deliberately unconfirmed. OCR output never becomes verified financial data automatically. */
export async function recordExtraction(userId: string, documentId: string, fields: Array<{ field: string; value: string; confidenceBps?: number }>) {
  const doc = await owned(userId, documentId);
  for (const field of fields) {
    await prisma.taxDocumentExtraction.create({
      data: {
        documentId, field: field.field, value: field.value.slice(0, 300),
        confidenceBps: field.confidenceBps ?? 0, userConfirmed: false,
      },
    });
  }
  await prisma.taxDocument.update({ where: { id: doc.id }, data: { status: "EXTRACTED" } });
  await securityAudit({ actorType: "SYSTEM", actorId: "tax-extraction", action: "TAX_DOCUMENT_EXTRACTED", targetType: "tax_document", targetId: documentId, metadata: { fieldCount: fields.length } });
  return { documentId, fields: fields.length, notice: "Extracted values are unconfirmed and are not used in calculations until you verify them." };
}

export async function confirmExtraction(userId: string, extractionId: string) {
  const extraction = await prisma.taxDocumentExtraction.findUnique({ where: { id: extractionId } });
  if (!extraction) throw new ApiError(404, "AUTHORIZATION_ERROR", "Extraction not found.");
  await owned(userId, extraction.documentId);
  await prisma.taxDocumentExtraction.update({ where: { id: extractionId }, data: { userConfirmed: true } });
  await prisma.taxDocumentVerification.create({
    data: { documentId: extraction.documentId, actorId: userId, status: "CONFIRMED", note: `${extraction.field} confirmed by user` },
  });
  return { id: extractionId, confirmed: true };
}

export async function listExtractions(userId: string, documentId: string) {
  await owned(userId, documentId);
  return prisma.taxDocumentExtraction.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } });
}

function reconView(row: {
  id: string; financialYear: string; category: string; sourceRef: string; amountMinor: number;
  matchLevel: string; matchedRef: string | null; status: string; note: string | null;
}): TaxReconciliationView {
  return {
    id: row.id, financialYear: row.financialYear, category: row.category, sourceRef: row.sourceRef,
    amountMinor: row.amountMinor, matchLevel: row.matchLevel, matchedRef: row.matchedRef,
    status: row.status, note: row.note,
  };
}

/** Matches statement rows against existing tax records with conservative confidence levels. */
export async function reconcileStatement(userId: string, rows: Array<{ category: string; sourceRef: string; amountMinor: number; occurredAt?: string }>, financialYear: string) {
  const existing = await Promise.all([
    prisma.taxIncomeRecord.findMany({ where: { userId, financialYear } }),
    prisma.taxCreditRecord.findMany({ where: { userId, financialYear } }),
  ]);
  const candidates = [...existing[0], ...existing[1]];
  let created = 0;
  for (const row of rows) {
    const exactAmount = candidates.find((c) => c.amountMinor === row.amountMinor);
    const matchLevel = exactAmount ? "HIGH" : "UNMATCHED";
    await prisma.taxReconciliationRecord.upsert({
      where: { userId_category_sourceRef: { userId, category: row.category, sourceRef: row.sourceRef } },
      create: {
        userId, financialYear, category: row.category, sourceRef: row.sourceRef,
        amountMinor: row.amountMinor, occurredAt: row.occurredAt ? new Date(row.occurredAt) : null,
        matchLevel: matchLevel as never, matchedRef: exactAmount ? exactAmount.id : null,
        rawPayload: row as object,
      },
      update: {},
    });
    created += 1;
  }
  await publishSecurityEvent({
    eventId: `tax_recon_${userId}_${financialYear}_${randomUUID().slice(0, 8)}`,
    type: "TAX_RECONCILIATION_REQUIRED", occurredAt: new Date(),
    actorId: userId, subjectId: financialYear, sourceModule: "tax",
  });
  return { created, notice: "Unmatched records are not errors and are never removed automatically." };
}

export async function listReconciliation(userId: string, financialYear: string) {
  const rows = await prisma.taxReconciliationRecord.findMany({
    where: { userId, financialYear }, orderBy: { createdAt: "desc" }, take: 200,
  });
  return rows.map(reconView);
}

export async function resolveReconciliation(userId: string, id: string, status: "CONFIRMED" | "RESOLVED", note: string) {
  const row = await prisma.taxReconciliationRecord.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Reconciliation record not found.");
  const updated = await prisma.taxReconciliationRecord.update({ where: { id }, data: { status, note } });
  await securityAudit({ actorType: "USER", actorId: userId, action: "TAX_RECONCILIATION_UPDATED", targetType: "tax_reconciliation_record", targetId: id, justification: note });
  return reconView(updated);
}
