import { createHash } from "node:crypto";
import { prisma } from "@nexus/database";
import { createRaftlineClient } from "@nexus/api-client";

/** Deterministic, lowercase, ≤24-char username for the labelled sandbox collection account. */
export function collectionUsername(billerCode: string): string {
  const hash = createHash("sha256").update(billerCode).digest("hex").slice(0, 8);
  return `bp_${hash}`;
}

/** Sandbox-only internal collection account so bill payments settle through the existing engine. */
export async function ensureCollectionUser(billerCode: string) {
  const username = collectionUsername(billerCode);
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return existing;
  const accountId = `np_bill_${username}`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "bill-payment-sandbox-collection" } });
  const phone = `+91${createHash("sha256").update(`phone:${billerCode}`).digest("hex").replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`;
  return prisma.user.create({
    data: {
      id: `billcol_${username}`, username, fullName: "Bill Payment Sandbox Collection",
      email: `${username}@billing.invalid`, phoneNumber: phone,
      passwordHash: "not-loginable", onboardingCompletedAt: new Date(),
      profile: { create: { displayName: "Bill Payment Sandbox Collection", preferredCurrency: "INR", preferredLanguage: "en-IN" } },
      wallets: { create: { currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() } },
    },
  });
}
