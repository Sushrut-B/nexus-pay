import { createHmac } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@nexus/database";
import type { InsuranceDocumentView } from "@nexus/shared-types";
import type { InsuranceDocumentUploadInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";

const DOC_DIR = path.join(process.cwd(), ".insurance-documents");
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "text/csv"]);
const MAX_BYTES = 5 * 1024 * 1024;

function view(row: {
  id: string; ownerType: string; ownerId: string; category: string; fileName: string;
  contentType: string; sizeBytes: number; status: string; scanStatus: string; uploadedAt: Date;
}): InsuranceDocumentView {
  return {
    id: row.id, ownerType: row.ownerType, ownerId: row.ownerId, category: row.category,
    fileName: row.fileName, contentType: row.contentType, sizeBytes: row.sizeBytes,
    status: row.status, scanStatus: row.scanStatus, uploadedAt: row.uploadedAt.toISOString(),
  };
}

async function assertOwnership(userId: string, ownerType: string, ownerId: string) {
  if (ownerType === "CLAIM") {
    const row = await prisma.insuranceClaim.findFirst({ where: { id: ownerId, userId } });
    if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Claim not found.");
  } else if (ownerType === "APPLICATION") {
    const row = await prisma.insuranceApplication.findFirst({ where: { id: ownerId, userId } });
    if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Application not found.");
  } else if (ownerType === "POLICY") {
    const row = await prisma.insurancePolicy.findFirst({ where: { id: ownerId, userId } });
    if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Policy not found.");
  } else {
    throw new ApiError(400, "VALIDATION_ERROR", "Unsupported document owner.");
  }
}

export async function uploadDocument(
  userId: string,
  ownerType: string,
  ownerId: string,
  input: InsuranceDocumentUploadInput,
  file: { bytes: Buffer; fileName: string; contentType: string },
): Promise<InsuranceDocumentView> {
  await assertOwnership(userId, ownerType, ownerId);
  if (!ALLOWED.has(file.contentType)) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported document type.");
  if (file.bytes.length === 0 || file.bytes.length > MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Document must be between 1 byte and 5 MB.");
  }
  const safeName = file.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const row = await prisma.insuranceDocument.create({
    data: {
      userId, ownerType, ownerId, category: input.category, fileName: safeName,
      contentType: file.contentType, sizeBytes: file.bytes.length,
      encryptedStorage: "", status: "UPLOADING", scanStatus: "NOT_AVAILABLE",
    },
  });
  try {
    const dir = path.join(DOC_DIR, userId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${row.id}.enc`);
    await writeFile(filePath, encryptSecret(file.bytes.toString("base64")), "utf8");
    await prisma.insuranceDocument.update({ where: { id: row.id }, data: { status: "READY", encryptedStorage: filePath } });
    await prisma.dataAccessAuditEvent.create({
      data: {
        userId, actorType: "USER", actorId: userId, action: "INSURANCE_DOCUMENT_UPLOADED",
        targetType: "insurance_document", targetId: row.id,
        metadata: { ownerType, category: input.category },
      },
    });
    return view(await prisma.insuranceDocument.findUniqueOrThrow({ where: { id: row.id } }));
  } catch (error) {
    await prisma.insuranceDocument.update({ where: { id: row.id }, data: { status: "FAILED" } });
    throw error;
  }
}

export async function listDocuments(userId: string, ownerType: string, ownerId: string): Promise<InsuranceDocumentView[]> {
  await assertOwnership(userId, ownerType, ownerId);
  const rows = await prisma.insuranceDocument.findMany({
    where: { userId, ownerType, ownerId, status: { not: "DELETED" } },
    orderBy: { uploadedAt: "desc" },
    take: 100,
  });
  return rows.map(view);
}

async function ownedDocument(userId: string, id: string) {
  const row = await prisma.insuranceDocument.findFirst({ where: { id, userId, status: { not: "DELETED" } } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Document not found.");
  await assertOwnership(userId, row.ownerType, row.ownerId);
  return row;
}

export function createDownloadToken(documentId: string, expiresAt: number): string {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${documentId}:${expiresAt}`).digest("hex");
}

export async function getDownloadLink(userId: string, id: string) {
  const row = await ownedDocument(userId, id);
  if (row.status !== "READY") throw new ApiError(409, "PAYMENT_ERROR", "Document is not ready.");
  const expiresAt = Date.now() + 5 * 60_000;
  await prisma.dataAccessAuditEvent.create({
    data: {
      userId, actorType: "USER", actorId: userId, action: "INSURANCE_DOCUMENT_ACCESS_GRANTED",
      targetType: "insurance_document", targetId: id,
    },
  });
  return { token: createDownloadToken(id, expiresAt), expiresAt, fileName: row.fileName };
}

export async function downloadDocument(userId: string, id: string, token: string, expiresAt: number) {
  const row = await ownedDocument(userId, id);
  if (expiresAt <= Date.now() || token !== createDownloadToken(id, expiresAt)) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Download link is invalid or expired.");
  }
  const ciphertext = await readFile(row.encryptedStorage, "utf8");
  const buffer = Buffer.from(decryptSecret(ciphertext), "base64");
  await prisma.dataAccessAuditEvent.create({
    data: {
      userId, actorType: "USER", actorId: userId, action: "INSURANCE_DOCUMENT_DOWNLOADED",
      targetType: "insurance_document", targetId: id,
    },
  });
  return { buffer, contentType: row.contentType, fileName: row.fileName };
}

export async function deleteDocument(userId: string, id: string) {
  const row = await ownedDocument(userId, id);
  await unlink(row.encryptedStorage).catch(() => undefined);
  await prisma.insuranceDocument.update({ where: { id }, data: { status: "DELETED", deletedAt: new Date(), encryptedStorage: "" } });
  await prisma.dataAccessAuditEvent.create({
    data: {
      userId, actorType: "USER", actorId: userId, action: "INSURANCE_DOCUMENT_DELETED",
      targetType: "insurance_document", targetId: id,
    },
  });
  return { id, status: "DELETED" };
}
