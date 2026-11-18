import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { LenderAdapter } from "@/lib/credit/lender-adapter";
import { SandboxLenderAdapter } from "@/lib/credit/providers/sandbox-lender";

export const LENDER_ONBOARDING_PREREQUISITES = [
  "A Regulated Entity (bank or RBI-registered NBFC) relationship and a defined Lending Service Provider role where applicable.",
  "Compliance with RBI Digital Lending Guidelines (2022) and Digital Lending Directions (2025): Key Fact Statement, cooling-off, direct RE disbursement/repayment, DLG caps and Digital Lending App reporting.",
  "Executed provider contracts, registered callback URLs and credentials/certificates in secret management.",
  "Verified consent, disclosure and data-sharing legal basis for applicant information and documents.",
  "Qualified legal/compliance review and explicit environment enablement.",
];

const adapters: LenderAdapter[] = [new SandboxLenderAdapter()];

export function isLenderEnabled(code: string): boolean {
  if (code !== "sandbox-lender") return false;
  return getServerEnv().NEXUS_CREDIT_SANDBOX_ENABLED;
}

export function getLenderAdapter(code: string): LenderAdapter {
  const adapter = adapters.find((candidate) => candidate.code === code);
  if (!adapter || !isLenderEnabled(code)) {
    throw new ApiError(
      503,
      "RAFTLINE_UNAVAILABLE",
      `Lender '${code}' is not configured. Prerequisites: ${LENDER_ONBOARDING_PREREQUISITES.join(" ")}`,
    );
  }
  return adapter;
}

export async function ensureLenderRecords() {
  for (const adapter of adapters) {
    const enabled = isLenderEnabled(adapter.code);
    await prisma.lendingProvider.upsert({
      where: { code: adapter.code },
      create: {
        code: adapter.code,
        displayName: adapter.displayName,
        mode: adapter.mode,
        capabilities: adapter.capabilities as object,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        config: { enabled, notice: enabled ? null : LENDER_ONBOARDING_PREREQUISITES.join(" ") },
      },
      update: {
        displayName: adapter.displayName,
        capabilities: adapter.capabilities as object,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        config: { enabled, notice: enabled ? null : LENDER_ONBOARDING_PREREQUISITES.join(" ") },
      },
    });
    for (const [capability, value] of Object.entries(adapter.capabilities)) {
      await prisma.lendingProviderCapability.upsert({
        where: { providerId_capability: { providerId: (await prisma.lendingProvider.findUniqueOrThrow({ where: { code: adapter.code } })).id, capability } },
        create: { providerId: (await prisma.lendingProvider.findUniqueOrThrow({ where: { code: adapter.code } })).id, capability, enabled: value },
        update: { enabled: value },
      });
    }
  }
  return prisma.lendingProvider.findMany({ orderBy: { displayName: "asc" } });
}

export function listLenderProviders() {
  return adapters.map((adapter) => ({
    code: adapter.code,
    displayName: adapter.displayName,
    mode: adapter.mode,
    capabilities: adapter.capabilities,
    available: isLenderEnabled(adapter.code),
    notice: isLenderEnabled(adapter.code)
      ? "Sandbox development fixture only — not a real credit offer or approval."
      : "Provider unavailable — onboarding prerequisites are not met.",
  }));
}

export { SANDBOX_LENDER_NOTICE } from "@/lib/credit/providers/sandbox-lender";
