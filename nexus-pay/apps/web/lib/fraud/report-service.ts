import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@nexus/database";
import type { FraudReportStatus, FraudReportView } from "@nexus/shared-types";
import type { FraudReportInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { securityAudit } from "@/lib/fraud/audit-service";

const DOC_DIR = path.join(process.cwd(), ".fraud-report-documents");
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "text/csv"]);
const MAX_BYTES = 5 * 1024 * 1024;

export const REPORT_NOTICE =
  "A fraud report records your concern for investigation. It does not reverse a payment or change its settlement status. No money has been moved by this report.";

const TRANSITIONS: Record<FraudReportStatus, FraudReportStatus[]> = {
  SUBMITTED: ["ACKNOWLEDGED", "UNDER_REVIEW", "CLOSED"],
  ACKNOWLEDGED: ["UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["ADDITIONAL_INFORMATION_REQUIRED", "ESCALATED", "RESOLVED", "CLOSED"],
  ADDITIONAL_INFORMATION_REQUIRED: ["UNDER_REVIEW", "CLOSED"],
  ESCALATED: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function reportView(row: {
  id: string; reference: string; transactionRef: string | null; category: string;
  description: string; status: string; resolution: string | null; createdAt: Date; updatedAt: Date;
}, documentCount = 0): FraudReportView {
  return {
    id: row.id, reference: row.reference, transactionRef: row.transactionRef,
    category: row.category, description: row.description,
    status: row.status as FraudReportStatus, resolution: row.resolution,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    documentCount,
  };
}

export async function createReport(userId: string, input: FraudReportInput): Promise<FraudReportView & { notice: string }> {
  const row = await prisma.customerFraudReport.create({
    data: {
      reference: `fr_${randomUUID()}`,
      userId,
      transactionRef: input.transactionRef ?? null,
      category: input.category,
      description: input.description,
      status: "SUBMITTED",
    },
  });
  await securityAudit({
    actorType: "USER", actorId: userId, action: "FRAUD_REPORT_SUBMITTED",
    targetType: "customer_fraud_report", targetId: row.id,
    metadata: { category: input.category, transactionRef: input.transactionRef },
  });
  return { ...reportView(row), notice: REPORT_NOTICE };
}

export async function listReports(userId: string): Promise<FraudReportView[]> {
  const rows = await prisma.customerFraudReport.findMany({
    where: { userId }, include: { _count: { select: { documents: true } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map((row) => reportView(row, row._count.documents));
}

async function ownedReport(userId: string, id: string) {
  const row = await prisma.customerFraudReport.findFirst({ where: { OR: [{ id }, { reference: id }], userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Fraud report not found.");
  return row;
}

export async function getReport(userId: string, id: string) {
  const row = await ownedReport(userId, id);
  const documents = await prisma.customerFraudReportDocument.findMany({ where: { reportId: row.id }, orderBy: { uploadedAt: "desc" } });
  return {
    ...reportView(row, documents.length),
    documents: documents.map((doc) => ({
      id: doc.id, fileName: doc.fileName, contentType: doc.contentType,
      sizeBytes: doc.sizeBytes, uploadedAt: doc.uploadedAt.toISOString(),
    })),
    notice: REPORT_NOTICE,
  };
}

export async function getReportHistory(userId: string, id: string) {
  const row = await ownedReport(userId, id);
  return prisma.securityAuditEvent.findMany({
    where: { targetType: "customer_fraud_report", targetId: row.id },
    orderBy: { createdAt: "asc" },
  });
}

export async function uploadReportDocument(userId: string, reportId: string, file: { bytes: Buffer; fileName: string; contentType: string }) {
  const report = await ownedReport(userId, reportId);
  if (!ALLOWED.has(file.contentType)) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported document type.");
  if (file.bytes.length === 0 || file.bytes.length > MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Document must be between 1 byte and 5 MB.");
  }
  const safeName = file.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const row = await prisma.customerFraudReportDocument.create({
    data: {
      reportId: report.id, userId, fileName: safeName, contentType: file.contentType,
      sizeBytes: file.bytes.length, storagePath: "", status: "UPLOADING",
    },
  });
  try {
    const dir = path.join(DOC_DIR, userId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${row.id}.enc`);
    await writeFile(filePath, encryptSecret(file.bytes.toString("base64")), "utf8");
    await prisma.customerFraudReportDocument.update({ where: { id: row.id }, data: { storagePath: filePath, status: "READY" } });
    await securityAudit({
      actorType: "USER", actorId: userId, action: "FRAUD_REPORT_DOCUMENT_UPLOADED",
      targetType: "customer_fraud_report", targetId: report.id, metadata: { documentId: row.id },
    });
    return { id: row.id, fileName: safeName, contentType: file.contentType, sizeBytes: file.bytes.length, status: "READY" };
  } catch (error) {
    await prisma.customerFraudReportDocument.update({ where: { id: row.id }, data: { status: "FAILED" } });
    throw error;
  }
}

export function createReportDownloadToken(documentId: string, expiresAt: number) {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${documentId}:${expiresAt}`).digest("hex");
}

export async function getReportDownloadLink(userId: string, documentId: string) {
  const doc = await prisma.customerFraudReportDocument.findFirst({ where: { id: documentId, userId, status: "READY" } });
  if (!doc) throw new ApiError(404, "AUTHORIZATION_ERROR", "Document not found.");
  await ownedReport(userId, doc.reportId);
  const expiresAt = Date.now() + 5 * 60_000;
  await securityAudit({
    actorType: "USER", actorId: userId, action: "FRAUD_REPORT_DOCUMENT_ACCESS",
    targetType: "customer_fraud_report_document", targetId: documentId,
  });
  return { token: createReportDownloadToken(documentId, expiresAt), expiresAt, fileName: doc.fileName };
}

export async function downloadReportDocument(userId: string, documentId: string, token: string, expiresAt: number) {
  const doc = await prisma.customerFraudReportDocument.findFirst({ where: { id: documentId, userId, status: "READY" } });
  if (!doc) throw new ApiError(404, "AUTHORIZATION_ERROR", "Document not found.");
  await ownedReport(userId, doc.reportId);
  if (expiresAt <= Date.now() || token !== createReportDownloadToken(documentId, expiresAt)) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Download link is invalid or expired.");
  }
  const buffer = Buffer.from(decryptSecret(await readFile(doc.storagePath, "utf8")), "base64");
  await securityAudit({
    actorType: "USER", actorId: userId, action: "FRAUD_REPORT_DOCUMENT_DOWNLOADED",
    targetType: "customer_fraud_report_document", targetId: documentId,
  });
  return { buffer, contentType: doc.contentType, fileName: doc.fileName };
}

/** Admin transition. Never alters a payment or its settlement status. */
export async function transitionReport(id: string, target: FraudReportStatus, actorId: string, notes?: string) {
  const row = await prisma.customerFraudReport.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Fraud report not found.");
  if (!TRANSITIONS[row.status as FraudReportStatus].includes(target)) {
    throw new ApiError(409, "PAYMENT_ERROR", `Cannot move a report from ${row.status} to ${target}.`);
  }
  const updated = await prisma.customerFraudReport.update({
    where: { id },
    data: {
      status: target,
      ...(notes ? { resolution: notes.slice(0, 1000) } : {}),
      ...(["RESOLVED", "CLOSED"].includes(target) ? { resolvedAt: new Date() } : {}),
    },
  });
  await securityAudit({
    actorType: "ADMIN", actorId, action: "FRAUD_REPORT_STATUS_CHANGED",
    targetType: "customer_fraud_report", targetId: id, justification: notes,
    metadata: { from: row.status, to: target },
  });
  return reportView(updated);
}

export const REPORT_TRANSITIONS = TRANSITIONS;


