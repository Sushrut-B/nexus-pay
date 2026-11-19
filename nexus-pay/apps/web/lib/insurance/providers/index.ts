import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { InsurerAdapter } from "@/lib/insurance/insurer-adapter";
import { SandboxInsurerAdapter } from "@/lib/insurance/providers/sandbox-insurer";

export const INSURER_ONBOARDING_PREREQUISITES = [
  "Verified IRDAI authorization for the intended role (insurer, broker, corporate agent or insurance web aggregator) under the Insurance Web Aggregators Regulations and related IRDAI guidance.",
  "Executed provider agreements, documented APIs, registered callback URLs and credentials held in secret management.",
  "Provider-approved disclosures, product wording, exclusions and quotation contracts.",
  "Explicit consent and privacy basis for sharing customer information with the provider.",
  "Qualified legal/compliance review and explicit environment enablement.",
];

const adapters: InsurerAdapter[] = [new SandboxInsurerAdapter()];

export function isInsurerEnabled(code: string): boolean {
  if (code !== "sandbox-insurer") return false;
  return getServerEnv().NEXUS_INSURANCE_SANDBOX_ENABLED;
}

export function getInsurerAdapter(code: string): InsurerAdapter {
  const adapter = adapters.find((candidate) => candidate.code === code);
  if (!adapter || !isInsurerEnabled(code)) {
    throw new ApiError(
      503,
      "RAFTLINE_UNAVAILABLE",
      `Insurer '${code}' is not configured. Prerequisites: ${INSURER_ONBOARDING_PREREQUISITES.join(" ")}`,
    );
  }
  return adapter;
}

export async function ensureInsurerRecords() {
  for (const adapter of adapters) {
    const enabled = isInsurerEnabled(adapter.code);
    const record = await prisma.insuranceProvider.upsert({
      where: { code: adapter.code },
      create: {
        code: adapter.code,
        displayName: adapter.displayName,
        mode: adapter.mode,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice: enabled ? null : INSURER_ONBOARDING_PREREQUISITES.join(" ") },
      },
      update: {
        displayName: adapter.displayName,
        capabilities: adapter.capabilities as object,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        config: { enabled, notice: enabled ? null : INSURER_ONBOARDING_PREREQUISITES.join(" ") },
      },
    });
    for (const [capability, value] of Object.entries(adapter.capabilities)) {
      await prisma.insuranceProviderCapability.upsert({
        where: { providerId_capability: { providerId: record.id, capability } },
        create: { providerId: record.id, capability, enabled: value },
        update: { enabled: value },
      });
    }
  }
  return prisma.insuranceProvider.findMany({ orderBy: { displayName: "asc" } });
}

export function listInsurerProviders() {
  return adapters.map((adapter) => ({
    code: adapter.code,
    displayName: adapter.displayName,
    mode: adapter.mode,
    capabilities: adapter.capabilities,
    available: isInsurerEnabled(adapter.code),
    notice: isInsurerEnabled(adapter.code)
      ? "Sandbox demonstration only — no real insurer or coverage."
      : "Provider unavailable — onboarding prerequisites are not met.",
  }));
}

export { SANDBOX_INSURER_NOTICE } from "@/lib/insurance/providers/sandbox-insurer";
