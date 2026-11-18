import { createHmac } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@nexus/database";
import type { DocumentView } from "@nexus/shared-types";
import type { DocumentUploadInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";

const DOC_DIR = path.join(process.cwd(), ".loan-documents");
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "text/csv"]);
const MAX_BYTES = 5 * 1024 * 1024;

function view(row: {
  id: string; category: string; fileName: string; contentType: string; sizeBytes: number;
  status: string; scanStatus: string; uploadedAt: Date;
}): DocumentView {
  return {
    id: row.id, category: row.category, fileName: row.fileName, contentType: row.contentType,
    sizeBytes: row.sizeBytes, status: row.status, scanStatus: row.scanStatus,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

export async function uploadDocument(
  userId: string,
  applicationId: string,
  input: DocumentUploadInput,
  file: { bytes: Buffer; fileName: string; contentType: string },
): Promise<DocumentView> {
  const application = await prisma.loanApplication.findFirst({ where: { id: applicationId, userId } });
  if (!application) throw new ApiError(404, "AUTHORIZATION_ERROR", "Loan application not found.");
  if (!["DRAFT", "READY_FOR_SUBMISSION", "ADDITIONAL_INFORMATION_REQUIRED", "UNDER_REVIEW"].includes(application.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "Documents cannot be added to this application.");
  }
  if (!ALLOWED.has(file.contentType)) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported document type.");
  if (file.bytes.length === 0 || file.bytes.length > MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Document must be between 1 byte and 5 MB.");
  }
  const safeName = file.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const row = await prisma.loanDocument.create({
    data: {
      applicationId, userId, category: input.category, fileName: safeName,
      contentType: file.contentType, sizeBytes: file.bytes.length, status: "UPLOADING",
      scanStatus: "NOT_AVAILABLE", encryptedStorage: "",
    },
  });
  try {
    const dir = path.join(DOC_DIR, userId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${row.id}.enc`);
    await writeFile(filePath, encryptSecret(file.bytes.toString("base64")), "utf8");
    await prisma.loanDocument.update({
      where: { id: row.id },
      data: { status: "READY", encryptedStorage: filePath },
    });
    await prisma.dataAccessAuditEvent.create({
      data: {
        userId, actorType: "USER", actorId: userId, action: "LOAN_DOCUMENT_UPLOADED",
        targetType: "loan_document", targetId: row.id,
        metadata: { category: input.category, sizeBytes: file.bytes.length },
      },
    });
    const updated = await prisma.loanDocument.findUniqueOrThrow({ where: { id: row.id } });
    return view(updated);
  } catch (error) {
    await prisma.loanDocument.update({ where: { id: row.id }, data: { status: "FAILED" } });
    throw error;
  }
}

export async function listDocuments(userId: string, applicationId: string): Promise<DocumentView[]> {
  const rows = await prisma.loanDocument.findMany({
    where: { userId, applicationId, status: { not: "DELETED" } },
    orderBy: { uploadedAt: "desc" },
  });
  return rows.map(view);
}

async function ownedDocument(userId: string, id: string) {
  const row = await prisma.loanDocument.findFirst({ where: { id, userId, status: { not: "DELETED" } } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Document not found.");
  return row;
}

export function createDownloadToken(documentId: string, expiresAt: number): string {
  return createHmac("sha256", getServerEnv().AUTH_SECRET)
    .update(`${documentId}:${expiresAt}`)
    .digest("hex");
}

export async function getDownloadLink(userId: string, id: string): Promise<{ token: string; expiresAt: number; fileName: string }> {
  const row = await ownedDocument(userId, id);
  if (row.status !== "READY") throw new ApiError(409, "PAYMENT_ERROR", "Document is not ready.");
  const expiresAt = Date.now() + 5 * 60_000;
  await prisma.dataAccessAuditEvent.create({
    data: {
      userId, actorType: "USER", actorId: userId, action: "LOAN_DOCUMENT_ACCESS_GRANTED",
      targetType: "loan_document", targetId: id,
    },
  });
  return { token: createDownloadToken(id, expiresAt), expiresAt, fileName: row.fileName };
}

export async function downloadDocument(
  userId: string,
  id: string,
  token: string,
  expiresAt: number,
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const row = await ownedDocument(userId, id);
  if (expiresAt <= Date.now() || token !== createDownloadToken(id, expiresAt)) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Download link is invalid or expired.");
  }
  const ciphertext = await readFile(row.encryptedStorage, "utf8");
  const buffer = Buffer.from(decryptSecret(ciphertext), "base64");
  await prisma.dataAccessAuditEvent.create({
    data: {
      userId, actorType: "USER", actorId: userId, action: "LOAN_DOCUMENT_DOWNLOADED",
      targetType: "loan_document", targetId: id,
    },
  });
  return { buffer, contentType: row.contentType, fileName: row.fileName };
}

export async function deleteDocument(userId: string, id: string): Promise<{ id: string; status: string }> {
  const row = await ownedDocument(userId, id);
  await unlink(row.encryptedStorage).catch(() => undefined);
  await prisma.loanDocument.update({
    where: { id }, data: { status: "DELETED", deletedAt: new Date(), encryptedStorage: "" },
  });
  await prisma.dataAccessAuditEvent.create({
    data: {
      userId, actorType: "USER", actorId: userId, action: "LOAN_DOCUMENT_DELETED",
      targetType: "loan_document", targetId: id,
    },
  });
  return { id, status: "DELETED" };
}
