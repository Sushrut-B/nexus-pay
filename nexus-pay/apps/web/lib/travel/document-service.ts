import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { securityAudit } from "@/lib/fraud/audit-service";

const DOC_DIR = path.join(process.cwd(), ".travel-documents");
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "text/csv"]);
const MAX_BYTES = 5 * 1024 * 1024;

async function owned(userId: string, id: string) {
  const row = await prisma.travelDocument.findFirst({ where: { id, userId, status: { not: "DELETED" } } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Travel document not found.");
  if (row.tripId) {
    const trip = await prisma.travelTrip.findFirst({ where: { id: row.tripId, userId } });
    if (!trip) throw new ApiError(404, "AUTHORIZATION_ERROR", "Travel document not found.");
  }
  if (row.bookingId) {
    const booking = await prisma.travelBooking.findFirst({ where: { id: row.bookingId, userId } });
    if (!booking) throw new ApiError(404, "AUTHORIZATION_ERROR", "Travel document not found.");
  }
  return row;
}

export async function listDocuments(userId: string, tripId?: string) {
  return prisma.travelDocument.findMany({
    where: { userId, ...(tripId ? { tripId } : {}), status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
}

export async function uploadDocument(userId: string, file: { bytes: Buffer; fileName: string; contentType: string }, input: { tripId?: string; bookingId?: string; kind: string }) {
  if (!ALLOWED.has(file.contentType)) throw new ApiError(400, "VALIDATION_ERROR", "Unsupported document type.");
  if (file.bytes.length === 0 || file.bytes.length > MAX_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Document must be between 1 byte and 5 MB.");
  }
  const row = await prisma.travelDocument.create({
    data: {
      userId, tripId: input.tripId ?? null, bookingId: input.bookingId ?? null,
      kind: input.kind, fileName: file.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120),
      contentType: file.contentType, sizeBytes: file.bytes.length, status: "UPLOADING",
    },
  });
  try {
    const dir = path.join(DOC_DIR, userId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${row.id}.enc`);
    await writeFile(filePath, encryptSecret(file.bytes.toString("base64")), "utf8");
    await prisma.travelDocument.update({ where: { id: row.id }, data: { storagePath: filePath, status: "READY" } });
    await securityAudit({ actorType: "USER", actorId: userId, action: "TRAVEL_DOCUMENT_UPLOADED", targetType: "travel_document", targetId: row.id });
    return { id: row.id, fileName: row.fileName, status: "READY" };
  } catch (error) {
    await prisma.travelDocument.update({ where: { id: row.id }, data: { status: "FAILED" } });
    throw error;
  }
}

export function createDocumentToken(documentId: string, expiresAt: number) {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${documentId}:${expiresAt}`).digest("hex");
}

export async function getDocumentLink(userId: string, id: string) {
  const row = await owned(userId, id);
  if (row.status !== "READY" || !row.storagePath) throw new ApiError(409, "PAYMENT_ERROR", "Document is not ready.");
  const expiresAt = Date.now() + 5 * 60_000;
  await securityAudit({ actorType: "USER", actorId: userId, action: "TRAVEL_DOCUMENT_ACCESS", targetType: "travel_document", targetId: id });
  return { token: createDocumentToken(id, expiresAt), expiresAt, fileName: row.fileName };
}

export async function downloadDocument(userId: string, id: string, token: string, expiresAt: number) {
  const row = await owned(userId, id);
  if (!row.storagePath) throw new ApiError(404, "AUTHORIZATION_ERROR", "Document not found.");
  if (expiresAt <= Date.now() || token !== createDocumentToken(id, expiresAt)) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Download link is invalid or expired.");
  }
  const buffer = Buffer.from(decryptSecret(await readFile(row.storagePath, "utf8")), "base64");
  await securityAudit({ actorType: "USER", actorId: userId, action: "TRAVEL_DOCUMENT_DOWNLOADED", targetType: "travel_document", targetId: id });
  return { buffer, contentType: row.contentType, fileName: row.fileName };
}
