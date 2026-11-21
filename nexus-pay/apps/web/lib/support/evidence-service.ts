/**
 * Release 19 — encrypted case evidence with authenticated, signed short-lived
 * download links. Evidence never changes payment or provider status.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import {
  ALLOWED_ATTACHMENT_TYPES, FORBIDDEN_FILE_EXTENSIONS, SUPPORT_NOTICE,
} from "@/lib/support/support-constants";
import { recordSupportAudit, supportSecurityAudit } from "@/lib/support/support-audit";

const EVIDENCE_DIR = path.join(process.cwd(), ".support-evidence");
const LINK_TTL_MS = 5 * 60 * 1000;

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "evidence";
}

function evidenceToken(attachmentId: string, expiresAt: number): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(`support-evidence:${attachmentId}:${expiresAt}`)
    .digest("hex");
}

async function ownedCase(userId: string, caseId: string) {
  const row = await prisma.supportCase.findFirst({ where: { id: caseId, userId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Case not found");
  return row;
}

export async function uploadEvidence(userId: string, caseId: string, file: {
  bytes: Buffer; fileName: string; contentType: string;
}) {
  await ownedCase(userId, caseId);
  const maxBytes = getServerEnv().NEXUS_SUPPORT_ATTACHMENT_MAX_BYTES;
  if (file.bytes.length < 1 || file.bytes.length > maxBytes) {
    throw new ApiError(400, "VALIDATION_ERROR", `Evidence must be between 1 byte and ${maxBytes} bytes`);
  }
  const contentType = file.contentType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Unsupported evidence file type");
  }
  const extension = path.extname(file.fileName).toLowerCase();
  if (FORBIDDEN_FILE_EXTENSIONS.has(extension)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Executable files are not accepted as evidence");
  }
  const fileName = safeFileName(file.fileName);
  const row = await prisma.supportMessageAttachment.create({
    data: {
      caseId, userId, fileName, contentType,
      sizeBytes: file.bytes.length,
      storagePath: "pending",
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      visibility: "CUSTOMER_VISIBLE",
    },
  });
  const directory = path.join(EVIDENCE_DIR, userId, caseId);
  await fs.mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, `${row.id}.enc`);
  await fs.writeFile(storagePath, encryptSecret(file.bytes.toString("base64")), { mode: 0o600 });
  await prisma.supportMessageAttachment.update({ where: { id: row.id }, data: { storagePath } });
  await prisma.supportCaseEvent.create({
    data: {
      caseId, kind: "EVIDENCE_ADDED",
      detail: `Evidence "${fileName}" was attached. ${SUPPORT_NOTICE}`,
      actorType: "CUSTOMER", actorId: userId, actorLabel: "Customer", customerVisible: true,
    },
  });
  await prisma.supportCase.update({ where: { id: caseId }, data: { lastActivityAt: new Date() } });
  await recordSupportAudit({ actorType: "CUSTOMER", actorId: userId, action: "SUPPORT_EVIDENCE_UPLOADED", targetType: "SUPPORT_ATTACHMENT", targetId: row.id });
  await supportSecurityAudit({
    actorType: "CUSTOMER", actorId: userId, action: "SUPPORT_EVIDENCE_STORED",
    targetType: "SUPPORT_ATTACHMENT", targetId: row.id,
    justification: "Case evidence encrypted at rest.",
  });
  return {
    id: row.id, fileName: row.fileName, contentType: row.contentType,
    sizeBytes: row.sizeBytes, uploadedAt: row.uploadedAt.toISOString(),
  };
}

export async function listEvidence(userId: string, caseId: string) {
  await ownedCase(userId, caseId);
  const rows = await prisma.supportMessageAttachment.findMany({
    where: { caseId, userId, removedAt: null }, orderBy: { uploadedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id, fileName: row.fileName, contentType: row.contentType,
    sizeBytes: row.sizeBytes, uploadedAt: row.uploadedAt.toISOString(), redacted: row.redacted,
  }));
}

export async function getEvidenceLink(userId: string, attachmentId: string) {
  const attachment = await prisma.supportMessageAttachment.findFirst({
    where: { id: attachmentId, userId, removedAt: null },
  });
  if (!attachment) throw new ApiError(404, "VALIDATION_ERROR", "Evidence not found");
  const expiresAt = Date.now() + LINK_TTL_MS;
  const token = evidenceToken(attachment.id, expiresAt);
  await recordSupportAudit({ actorType: "CUSTOMER", actorId: userId, action: "SUPPORT_EVIDENCE_LINK_CREATED", targetType: "SUPPORT_ATTACHMENT", targetId: attachment.id });
  return `/api/support/attachments/${attachment.id}/download?token=${token}&expiresAt=${expiresAt}`;
}

export async function downloadEvidence(userId: string, attachmentId: string, token: string, expiresAtRaw: string) {
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new ApiError(401, "AUTHENTICATION_ERROR", "Evidence link expired");
  }
  const expected = evidenceToken(attachmentId, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, "AUTHENTICATION_ERROR", "Invalid evidence link");
  }
  const attachment = await prisma.supportMessageAttachment.findFirst({
    where: { id: attachmentId, removedAt: null },
  });
  if (!attachment || attachment.userId !== userId) {
    throw new ApiError(404, "VALIDATION_ERROR", "Evidence not found");
  }
  const bytes = Buffer.from(decryptSecret(await fs.readFile(attachment.storagePath, "utf8")), "base64");
  await recordSupportAudit({ actorType: "CUSTOMER", actorId: userId, action: "SUPPORT_EVIDENCE_DOWNLOADED", targetType: "SUPPORT_ATTACHMENT", targetId: attachment.id });
  await supportSecurityAudit({
    actorType: "CUSTOMER", actorId: userId, action: "SUPPORT_EVIDENCE_ACCESSED",
    targetType: "SUPPORT_ATTACHMENT", targetId: attachment.id,
    justification: "Authenticated signed-link download.",
  });
  return { bytes, fileName: attachment.fileName, contentType: attachment.contentType };
}

export async function removeEvidence(userId: string, attachmentId: string) {
  const attachment = await prisma.supportMessageAttachment.findFirst({
    where: { id: attachmentId, userId, removedAt: null },
  });
  if (!attachment) throw new ApiError(404, "VALIDATION_ERROR", "Evidence not found");
  const row = await prisma.supportCase.findFirst({ where: { id: attachment.caseId, userId } });
  if (!row || row.status === "CLOSED") throw new ApiError(409, "VALIDATION_ERROR", "Evidence cannot be removed from a closed case");
  await prisma.supportMessageAttachment.update({ where: { id: attachment.id }, data: { removedAt: new Date() } });
  await fs.unlink(attachment.storagePath).catch(() => undefined);
  await recordSupportAudit({ actorType: "CUSTOMER", actorId: userId, action: "SUPPORT_EVIDENCE_REMOVED", targetType: "SUPPORT_ATTACHMENT", targetId: attachment.id });
}
