import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { BillerAdapter } from "@/lib/billing/biller-adapter";
import { SandboxBillerAdapter } from "@/lib/billing/providers/sandbox-biller";

export const BILLER_ONBOARDING_PREREQUISITES = [
  "Verified authorisation for the intended role under RBI/NPCI Bharat Connect (BBPS) rules, including BBPOU/COU/BOU status where applicable. Nexus Pay has no such authorisation.",
  "Executed provider agreements, documented bill-fetch and payment APIs, registered callback URLs and credentials in secret management.",
  "Provider-approved biller catalogue, parameter metadata, plan data and disclosure wording.",
  "Explicit consent and privacy basis for sharing customer identifiers with the provider.",
  "Qualified legal/compliance review and explicit environment enablement.",
];

const adapters: BillerAdapter[] = [new SandboxBillerAdapter()];

export function isBillerProviderEnabled(code: string): boolean {
  return code === "sandbox-biller" && getServerEnv().NEXUS_BILLING_SANDBOX_ENABLED;
}

export function getBillerAdapter(code: string): BillerAdapter {
  const adapter = adapters.find((candidate) => candidate.code === code);
  if (!adapter || !isBillerProviderEnabled(code)) {
    throw new ApiError(503, "RAFTLINE_UNAVAILABLE", `Bill payment provider '${code}' is not configured. ${BILLER_ONBOARDING_PREREQUISITES.join(" ")}`);
  }
  return adapter;
}

export async function ensureBillerRecords() {
  for (const adapter of adapters) {
    const enabled = isBillerProviderEnabled(adapter.code);
    const record = await prisma.billPaymentProvider.upsert({
      where: { code: adapter.code },
      create: {
        code: adapter.code, displayName: adapter.displayName, mode: adapter.mode,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice: enabled ? "Sandbox demonstration only — not real billers or bills." : BILLER_ONBOARDING_PREREQUISITES.join(" ") },
      },
      update: {
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice: enabled ? "Sandbox demonstration only — not real billers or bills." : BILLER_ONBOARDING_PREREQUISITES.join(" ") },
      },
    });
    for (const [capability, value] of Object.entries(adapter.capabilities)) {
      await prisma.billPaymentProviderCapability.upsert({
        where: { providerId_capability: { providerId: record.id, capability } },
        create: { providerId: record.id, capability, enabled: value },
        update: { enabled: value },
      });
    }
  }
}

export function listBillerProviders() {
  return adapters.map((adapter) => {
    const available = isBillerProviderEnabled(adapter.code);
    return {
      code: adapter.code, displayName: adapter.displayName, mode: adapter.mode,
      capabilities: adapter.capabilities, available,
      notice: available ? "Sandbox demonstration only — no real billers or bills." : "Provider unavailable — onboarding prerequisites are not met.",
    };
  });
}

export { SANDBOX_BILLER_NOTICE } from "@/lib/billing/providers/sandbox-biller";
