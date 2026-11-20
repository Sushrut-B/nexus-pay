import { createHmac } from "node:crypto";
import { prisma } from "@nexus/database";
import type { BillReceiptView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { securityAudit } from "@/lib/fraud/audit-service";

const CONFIRMED_ONLY = ["BILLER_CONFIRMED", "REFUNDED"];

export function receiptView(row: {
  id: string; reference: string; kind: string; amountMinor: number; status: string;
  officialProviderReceipt: boolean; createdAt: Date;
}): BillReceiptView {
  return {
    id: row.id, reference: row.reference, kind: row.kind, amountMinor: row.amountMinor,
    status: row.status, officialProviderReceipt: row.officialProviderReceipt,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Generates a Nexus Pay payment record receipt — never an official biller receipt.
 * Only available after verified wallet settlement; BILLER_CONFIRMED additionally
 * indicates provider confirmation.
 */
export async function createReceipt(userId: string, paymentId: string) {
  const payment = await prisma.billPaymentIntent.findFirst({ where: { id: paymentId, userId } });
  if (!payment) throw new ApiError(404, "AUTHORIZATION_ERROR", "Bill payment not found.");
  if (!["WALLET_SETTLED", ...CONFIRMED_ONLY].includes(payment.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "A receipt is available only after a confirmed wallet settlement.");
  }
  const existing = await prisma.billPaymentReceipt.findFirst({ where: { paymentId, userId } });
  if (existing) return receiptView(existing);
  const row = await prisma.billPaymentReceipt.create({
    data: {
      paymentId, userId, reference: `receipt_${payment.reference}`,
      kind: "NEXUS_PAYMENT_RECORD", amountMinor: payment.totalMinor,
      status: payment.status, officialProviderReceipt: false,
    },
  });
  await securityAudit({ actorType: "USER", actorId: userId, action: "BILL_RECEIPT_CREATED", targetType: "bill_payment_receipt", targetId: row.id });
  return receiptView(row);
}

export async function getReceipt(userId: string, paymentId: string) {
  const row = await prisma.billPaymentReceipt.findFirst({ where: { paymentId, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Receipt not found.");
  return receiptView(row);
}

export async function listReceipts(userId: string) {
  const rows = await prisma.billPaymentReceipt.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map(receiptView);
}

/** Signed short-lived URL for an official provider PDF when one has been stored. */
export async function getOfficialReceiptLink(userId: string, receiptId: string) {
  const row = await prisma.billPaymentReceipt.findFirst({ where: { id: receiptId, userId } });
  if (!row || !row.storagePath || !row.officialProviderReceipt) {
    throw new ApiError(404, "AUTHORIZATION_ERROR", "Official provider receipt not available.");
  }
  const expiresAt = Date.now() + 5 * 60_000;
  const token = createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${receiptId}:${expiresAt}`).digest("hex");
  await securityAudit({ actorType: "USER", actorId: userId, action: "BILL_RECEIPT_ACCESSED", targetType: "bill_payment_receipt", targetId: receiptId });
  return { token, expiresAt, fileName: row.fileName ?? "receipt.pdf" };
}
