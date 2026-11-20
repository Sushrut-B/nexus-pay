import { createHash } from "node:crypto";
import { prisma } from "@nexus/database";
import { createRaftlineClient } from "@nexus/api-client";

/** Deterministic, lowercase, ≤24-char username for the labelled sandbox collection account. */
export function travelCollectionUsername(providerCode: string): string {
  return `tv_${createHash("sha256").update(providerCode).digest("hex").slice(0, 8)}`;
}

/** Sandbox-only internal collection account so bookings settle through the existing engine. */
export async function ensureTravelCollectionUser(providerCode: string) {
  const username = travelCollectionUsername(providerCode);
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return existing;
  const accountId = `np_travel_${username}`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "travel-sandbox-collection" } });
  const phone = `+91${createHash("sha256").update(`travelphone:${providerCode}`).digest("hex").replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`;
  return prisma.user.create({
    data: {
      id: `travelcol_${username}`, username, fullName: "Travel Sandbox Collection",
      email: `${username}@travel.invalid`, phoneNumber: phone,
      passwordHash: "not-loginable", onboardingCompletedAt: new Date(),
      profile: { create: { displayName: "Travel Sandbox Collection", preferredCurrency: "INR", preferredLanguage: "en-IN" } },
      wallets: { create: { currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() } },
    },
  });
}
