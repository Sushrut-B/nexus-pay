import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { ProviderAdapter } from "@/lib/accounts/provider-adapter";
import { SandboxProviderAdapter } from "@/lib/accounts/providers/sandbox-provider";

export { SANDBOX_NOTICE } from "@/lib/accounts/providers/sandbox-provider";

export const PROVISIONING_PREREQUISITES = [
  "A registered and authorised provider relationship (for India: an RBI-regulated Account Aggregator ecosystem participant and Financial Information User arrangement).",
  "Executed data-sharing agreements and provider-approved client credentials/certificates.",
  "Verified consent flow and callback registration with the provider.",
  "Qualified legal/compliance review of consent, retention and data-minimisation obligations.",
  "Explicit enablement via environment configuration after the above are complete.",
];

const adapters: ProviderAdapter[] = [new SandboxProviderAdapter()];

export function isProviderEnabled(code: string): boolean {
  if (code !== "sandbox") return false;
  return getServerEnv().NEXUS_EXTERNAL_SANDBOX_ENABLED;
}

export function getProviderAdapter(code: string): ProviderAdapter {
  const adapter = adapters.find((candidate) => candidate.code === code);
  if (!adapter || !isProviderEnabled(code)) {
    throw new ApiError(
      503,
      "RAFTLINE_UNAVAILABLE",
      `Provider '${code}' is not configured in this environment. Prerequisites: ${PROVISIONING_PREREQUISITES.join(" ")}`,
    );
  }
  return adapter;
}

/** Ensure configured provider rows exist for UI and Control visibility. */
export async function ensureProviderRecords() {
  for (const adapter of adapters) {
    const isEnabled = isProviderEnabled(adapter.code);
    await prisma.externalFinancialProvider.upsert({
      where: { code: adapter.code },
      create: {
        code: adapter.code,
        displayName: adapter.displayName,
        mode: adapter.mode,
        capabilities: adapter.capabilities as object,
        status: isEnabled ? "AVAILABLE" : "UNAVAILABLE",
        config: { enabled: isEnabled, notice: isEnabled ? null : PROVISIONING_PREREQUISITES.join(" ") },
      },
      update: {
        displayName: adapter.displayName,
        capabilities: adapter.capabilities as object,
        status: isEnabled ? "AVAILABLE" : "UNAVAILABLE",
        config: { enabled: isEnabled, notice: isEnabled ? null : PROVISIONING_PREREQUISITES.join(" ") },
      },
    });
  }
  return prisma.externalFinancialProvider.findMany({ orderBy: { displayName: "asc" } });
}

export function listAvailableProviders() {
  return adapters.map((adapter) => ({
    code: adapter.code,
    displayName: adapter.displayName,
    mode: adapter.mode,
    capabilities: adapter.capabilities,
    available: isProviderEnabled(adapter.code),
    notice: isProviderEnabled(adapter.code)
      ? "Sandbox test provider — deterministic test data only."
      : "Connection unavailable. Production prerequisites are documented in docs/external-account-connection.md.",
  }));
}
