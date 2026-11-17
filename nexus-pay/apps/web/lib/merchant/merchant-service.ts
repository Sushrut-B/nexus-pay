
import { prisma, type Merchant } from "@nexus/database";
import type { MerchantStatus, MerchantView } from "@nexus/shared-types";
import type { MerchantCreateInput, MerchantUpdateInput } from "@nexus/validation";
import { createRaftlineClient } from "@nexus/api-client";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/control/audit";

export function toMerchantView(merchant: Merchant): MerchantView {
  return {
    id: merchant.id,
    handle: merchant.handle,
    businessName: merchant.businessName,
    displayName: merchant.displayName,
    businessType: merchant.businessType,
    category: merchant.category,
    description: merchant.description,
    email: merchant.email,
    phone: merchant.phone,
    website: merchant.website,
    logoUrl: merchant.logoUrl,
    brandColor: merchant.brandColor,
    status: merchant.status,
    currency: merchant.currency,
    createdAt: merchant.createdAt.toISOString(),
  };
}

export async function getMerchantForUser(userId: string): Promise<Merchant | null> {
  return prisma.merchant.findFirst({
    where: {
      OR: [
        { ownerUserId: userId },
        { members: { some: { userId, removedAt: null } } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function requireMerchantForUser(userId: string): Promise<Merchant> {
  const merchant = await getMerchantForUser(userId);
  if (!merchant) throw new ApiError(404, "AUTHORIZATION_ERROR", "No merchant account is linked to your user.");
  return merchant;
}

export async function requireActiveMerchant(userId: string): Promise<Merchant> {
  const merchant = await requireMerchantForUser(userId);
  if (merchant.status !== "ACTIVE") {
    throw new ApiError(409, "PAYMENT_ERROR", "This merchant account cannot accept payments in its current state.");
  }
  return merchant;
}

export async function createMerchant(userId: string, input: MerchantCreateInput): Promise<MerchantView> {
  const existing = await prisma.merchant.findFirst({ where: { ownerUserId: userId } });
  if (existing) throw new ApiError(409, "VALIDATION_ERROR", "You already have a merchant account.");

  const merchant = await prisma.merchant.create({
    data: {
      ownerUserId: userId,
      handle: input.handle.toLowerCase(),
      businessName: input.businessName,
      displayName: input.displayName,
      businessType: input.businessType,
      category: input.category,
      description: input.description ?? null,
      email: input.email.toLowerCase(),
      phone: input.phone,
      website: input.website ?? null,
      address: input.address ?? null,
      logoUrl: input.logoUrl ?? null,
      brandColor: input.brandColor ?? null,
      supportEmail: input.supportEmail ?? null,
      supportPhone: input.supportPhone ?? null,
      refundPolicy: input.refundPolicy ?? null,
      currency: "INR",
      status: "DRAFT",
      members: { create: { userId, role: "OWNER" } },
      approvalEvents: { create: { fromStatus: "DRAFT", toStatus: "DRAFT", reason: "Merchant account created" } },
    },
  });
  return toMerchantView(merchant);
}

export async function updateMerchant(userId: string, input: MerchantUpdateInput): Promise<MerchantView> {
  const merchant = await requireMerchantForUser(userId);
  if (merchant.ownerUserId !== userId) throw new ApiError(403, "AUTHORIZATION_ERROR", "Only the owner can edit business details.");
  const updated = await prisma.merchant.update({
    where: { id: merchant.id },
    data: {
      handle: input.handle ? input.handle.toLowerCase() : undefined,
      businessName: input.businessName,
      displayName: input.displayName,
      businessType: input.businessType,
      category: input.category,
      description: input.description,
      email: input.email ? input.email.toLowerCase() : undefined,
      phone: input.phone,
      website: input.website,
      logoUrl: input.logoUrl,
      brandColor: input.brandColor,
      supportEmail: input.supportEmail,
      supportPhone: input.supportPhone,
      refundPolicy: input.refundPolicy,
    },
  });
  return toMerchantView(updated);
}

export async function getMerchantStatus(userId: string): Promise<MerchantView | null> {
  const merchant = await getMerchantForUser(userId);
  return merchant ? toMerchantView(merchant) : null;
}

/**
 * Idempotent merchant wallet provisioning through the existing Raftline flow.
 * A lost response is safe: the account id is deterministic and checked first.
 */
export async function provisionMerchantWallet(userId: string): Promise<MerchantView> {
  const merchant = await requireMerchantForUser(userId);
  if (merchant.ownerUserId !== userId) throw new ApiError(403, "AUTHORIZATION_ERROR", "Only the owner can provision the business wallet.");
  if (merchant.raftlineAccountId) return toMerchantView(merchant);

  const accountId = `np_merchant_${merchant.id}`.replace(/[^A-Za-z0-9_.-]/g, "_");
  const client = createRaftlineClient();
  await client.ensureAccount({ accountId, currency: "INR", metadata: { source: "merchant-sandbox" } });
  const account = await client.getAccount(accountId);
  if (!account || account.currency !== "INR") {
    throw new ApiError(502, "WALLET_PROVISIONING_ERROR", "The merchant ledger account could not be verified.");
  }

  const updated = await prisma.merchant.update({
    where: { id: merchant.id },
    data: { raftlineAccountId: accountId, walletId: accountId },
  });
  return toMerchantView(updated);
}

export async function submitMerchantForReview(userId: string): Promise<MerchantView> {
  const merchant = await requireMerchantForUser(userId);
  if (!merchant.raftlineAccountId) throw new ApiError(409, "PAYMENT_ERROR", "Provision the business wallet before submitting.");
  if (merchant.status !== "DRAFT") throw new ApiError(409, "PAYMENT_ERROR", "This merchant is not in draft state.");
  const updated = await prisma.merchant.update({
    where: { id: merchant.id },
    data: {
      status: "PENDING_REVIEW",
      approvalEvents: {
        create: { fromStatus: merchant.status, toStatus: "PENDING_REVIEW", reason: "Submitted for sandbox review" },
      },
    },
  });
  return toMerchantView(updated);
}

/** Used by Nexus Control only. */
export async function setMerchantStatus(
  merchantId: string,
  status: MerchantStatus,
  admin: { id: string; email: string; roleName: string },
  reason: string,
  requestId?: string,
): Promise<MerchantView> {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new ApiError(404, "AUTHORIZATION_ERROR", "Merchant not found.");
  const updated = await prisma.merchant.update({
    where: { id: merchantId },
    data: {
      status,
      approvalEvents: {
        create: {
          fromStatus: merchant.status,
          toStatus: status,
          reason,
          actorAdminId: admin.id,
        },
      },
    },
  });
  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.roleName,
    action: "MERCHANT_STATUS_CHANGED",
    targetType: "merchant",
    targetId: merchantId,
    reason,
    requestId,
    outcome: "SUCCESS",
    metadata: { from: merchant.status, to: status },
  });
  return toMerchantView(updated);
}

export async function listMerchantsForControl(): Promise<MerchantView[]> {
  const merchants = await prisma.merchant.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return merchants.map((merchant) => toMerchantView(merchant));
}

