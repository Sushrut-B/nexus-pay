import { prisma, type BillFetchStatus, type BillSnapshot } from "@nexus/database";
import type { BillSnapshotView } from "@nexus/shared-types";
import type { BillFetchInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getBillerAdapter } from "@/lib/billing/providers";
import { getInternalBiller } from "@/lib/billing/catalog-service";
import { getAccountParameters } from "@/lib/billing/account-service";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

const TRANSITIONS: Record<BillFetchStatus, BillFetchStatus[]> = {
  FETCH_REQUESTED: ["FETCH_PROCESSING", "FETCHED", "NOT_FOUND", "INVALID_CUSTOMER_DETAILS", "FETCH_FAILED"],
  FETCH_PROCESSING: ["FETCHED", "NOT_FOUND", "FETCH_FAILED", "UNKNOWN"],
  FETCHED: ["EXPIRED", "PAID"],
  NOT_FOUND: [], INVALID_CUSTOMER_DETAILS: [], FETCH_FAILED: ["FETCH_PROCESSING"],
  EXPIRED: [], PAID: [], UNKNOWN: ["FETCH_PROCESSING", "FETCH_FAILED"],
};

export function snapshotView(row: BillSnapshot): BillSnapshotView {
  return {
    id: row.id, fetchRequestId: row.fetchRequestId, billNumber: row.billNumber,
    billPeriod: row.billPeriod, billDate: row.billDate?.toISOString() ?? null,
    dueDate: row.dueDate?.toISOString() ?? null, amountMinor: row.amountMinor,
    minAmountMinor: row.minAmountMinor, lateFeeMinor: row.lateFeeMinor,
    extraChargesMinor: row.extraChargesMinor, status: row.status,
    fetchedAt: row.fetchedAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null,
    isSandbox: true,
  };
}

async function requestView(id: string, userId?: string) {
  const row = await prisma.billFetchRequest.findFirst({
    where: { id, ...(userId ? { userId } : {}) }, include: { snapshots: { orderBy: { fetchedAt: "desc" } } },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Bill fetch request not found.");
  return {
    id: row.id, billerId: row.billerId, status: row.status,
    error: row.error, createdAt: row.createdAt.toISOString(),
    snapshots: row.snapshots.map(snapshotView),
  };
}

export async function fetchBill(userId: string, input: BillFetchInput) {
  const biller = await getInternalBiller(input.billerId);
  const provider = await prisma.billPaymentProvider.findUniqueOrThrow({ where: { id: biller.providerId } });
  const adapter = getBillerAdapter(provider.code);
  if (!adapter.capabilities.billFetch || !biller.canFetchBill) {
    throw new ApiError(409, "PAYMENT_ERROR", "This biller does not support bill fetch.");
  }
  const parameters = input.accountId
    ? await getAccountParameters(userId, input.accountId)
    : input.parameters;
  const validity = await adapter.validateCustomerDetails(biller.code, parameters);
  if (!validity.valid) {
    const request = await prisma.billFetchRequest.create({
      data: { userId, billerId: biller.id, accountId: input.accountId ?? null, parameters: parameters as object, status: "INVALID_CUSTOMER_DETAILS", error: validity.message ?? "Invalid customer details" },
    });
    return requestView(request.id, userId);
  }

  const request = await prisma.billFetchRequest.create({
    data: { userId, billerId: biller.id, accountId: input.accountId ?? null, parameters: parameters as object, status: "FETCH_PROCESSING" },
  });
  await publishSecurityEvent({
    eventId: `bill_fetch_${request.id}`, type: "BILL_FETCH_REQUESTED", occurredAt: new Date(),
    actorId: userId, subjectId: biller.id, sourceModule: "billing", metadata: { billerId: biller.id },
  });

  let result;
  try {
    result = await adapter.fetchBill(biller.code, parameters);
  } catch (error) {
    await prisma.billFetchRequest.update({ where: { id: request.id }, data: { status: "FETCH_FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Fetch failed" } });
    return requestView(request.id, userId);
  }
  if (!result) {
    await prisma.billFetchRequest.update({ where: { id: request.id }, data: { status: "NOT_FOUND" } });
    return requestView(request.id, userId);
  }
  await prisma.billFetchRequest.update({ where: { id: request.id }, data: { status: "FETCHED", providerRef: result.providerRef } });
  await prisma.billSnapshot.create({
    data: {
      fetchRequestId: request.id, providerRef: result.providerRef,
      billNumber: result.billNumber ?? null, billPeriod: result.billPeriod ?? null,
      billDate: result.billDate ?? null, dueDate: result.dueDate ?? null,
      amountMinor: result.amountMinor, minAmountMinor: result.minAmountMinor ?? null,
      lateFeeMinor: result.lateFeeMinor ?? null, extraChargesMinor: result.extraChargesMinor ?? null,
      status: result.status ?? "FETCHED", rawPayload: (result.rawPayload ?? {}) as object,
      expiresAt: result.validUntil ?? new Date(Date.now() + 2 * 86_400_000),
    },
  });
  if (input.accountId) {
    await prisma.savedBillerAccount.update({ where: { id: input.accountId }, data: { lastFetchAt: new Date() } });
  }
  return requestView(request.id, userId);
}

export async function getFetch(userId: string, id: string) {
  return requestView(id, userId);
}

/** Revalidates a bill before payment. Stale bills must be refreshed, never paid blindly. */
export async function getPayableSnapshot(userId: string, snapshotId: string) {
  const snapshot = await prisma.billSnapshot.findUnique({
    where: { id: snapshotId }, include: { fetchRequest: true },
  });
  if (!snapshot || snapshot.fetchRequest.userId !== userId) {
    throw new ApiError(404, "AUTHORIZATION_ERROR", "Bill snapshot not found.");
  }
  if (snapshot.expiresAt && snapshot.expiresAt <= new Date()) {
    await prisma.billSnapshot.update({ where: { id: snapshotId }, data: { status: "EXPIRED" } });
    throw new ApiError(409, "PAYMENT_ERROR", "This bill has expired. Refresh it before paying.");
  }
  if (snapshot.status !== "FETCHED") {
    throw new ApiError(409, "PAYMENT_ERROR", "This bill is not payable in its current state.");
  }
  return snapshot;
}

export async function refreshSnapshot(userId: string, snapshotId: string) {
  const snapshot = await prisma.billSnapshot.findUnique({ where: { id: snapshotId }, include: { fetchRequest: true } });
  if (!snapshot || snapshot.fetchRequest.userId !== userId) throw new ApiError(404, "AUTHORIZATION_ERROR", "Bill snapshot not found.");
  const biller = await getInternalBiller(snapshot.fetchRequest.billerId);
  const adapter = getBillerAdapter((await prisma.billPaymentProvider.findUniqueOrThrow({ where: { id: biller.providerId } })).code);
  const result = snapshot.providerRef ? await adapter.verifyBill(biller.code, snapshot.providerRef) : null;
  if (!result) {
    await prisma.billSnapshot.update({ where: { id: snapshotId }, data: { status: "EXPIRED" } });
    throw new ApiError(409, "PAYMENT_ERROR", "The provider could not revalidate this bill.");
  }
  const updated = await prisma.billSnapshot.create({
    data: {
      fetchRequestId: snapshot.fetchRequestId, providerRef: result.providerRef,
      billNumber: result.billNumber ?? null, billPeriod: result.billPeriod ?? null,
      billDate: result.billDate ?? null, dueDate: result.dueDate ?? null,
      amountMinor: result.amountMinor, minAmountMinor: result.minAmountMinor ?? null,
      lateFeeMinor: result.lateFeeMinor ?? null, extraChargesMinor: result.extraChargesMinor ?? null,
      status: "FETCHED", rawPayload: (result.rawPayload ?? {}) as object,
      expiresAt: result.validUntil ?? new Date(Date.now() + 2 * 86_400_000),
    },
  });
  return snapshotView(updated);
}

export const BILL_FETCH_TRANSITIONS = TRANSITIONS;
