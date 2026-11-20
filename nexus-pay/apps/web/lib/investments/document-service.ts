import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { readFile } from "node:fs/promises";
import { documentToken } from "@/lib/investments/discovery-service";
import { securityAudit } from "@/lib/fraud/audit-service";

const DOC_DIR = path.join(process.cwd(), ".investment-documents");
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "text/csv"]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function listDocuments(userId: string) {
  return prisma.investmentDocument.findMany({
    where: { userId, status: { not: "DELETED" } }, orderBy: { createdAt: "desc" }, take: 100,
  });
}

export async function uploadDocument(userId: string, file: { bytes: Buffer; fileName: string; contentType: string }, input: { connectionId?: string; accountId?: string; kind: string; providerRef?: string }) {
  if (!ALLOWED.has(file.contentType)) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported document type.");
  if (file.bytes.length === 0 || file.bytes.length > MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Document must be between 1 byte and 5 MB.");
  }
  const row = await prisma.investmentDocument.create({
    data: {
      userId, connectionId: input.connectionId ?? null, accountId: input.accountId ?? null,
      kind: input.kind, fileName: file.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120),
      contentType: file.contentType, sizeBytes: file.bytes.length, status: "PENDING",
      providerRef: input.providerRef ?? null,
    },
  });
  try {
    const dir = path.join(DOC_DIR, userId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${row.id}.enc`);
    await writeFile(filePath, encryptSecret(file.bytes.toString("base64")), "utf8");
    await prisma.investmentDocument.update({ where: { id: row.id }, data: { storagePath: filePath, status: "READY" } });
    await securityAudit({ actorType: "USER", actorId: userId, action: "INVESTMENT_DOCUMENT_UPLOADED", targetType: "investment_document", targetId: row.id });
    return { id: row.id, fileName: row.fileName, status: "READY" };
  } catch (error) {
    await prisma.investmentDocument.update({ where: { id: row.id }, data: { status: "FAILED" } });
    throw error;
  }
}

export async function downloadDocument(userId: string, id: string, token: string, expiresAt: number) {
  const row = await prisma.investmentDocument.findFirst({ where: { id, userId, status: "READY", storagePath: { not: null } } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Investment document not found.");
  if (expiresAt <= Date.now() || token !== documentToken(id, expiresAt)) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Download link is invalid or expired.");
  }
  const buffer = Buffer.from(decryptSecret(await readFile(row.storagePath!, "utf8")), "base64");
  await securityAudit({ actorType: "USER", actorId: userId, action: "INVESTMENT_DOCUMENT_DOWNLOADED", targetType: "investment_document", targetId: id });
  return { buffer, contentType: row.contentType, fileName: row.fileName };
}
