import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { InvestmentAdapter } from "@/lib/investments/investment-adapter";
import { SandboxInvestmentAdapter } from "@/lib/investments/providers/sandbox-investments";

export const INVESTMENT_ONBOARDING_PREREQUISITES = [
  "Verified SEBI/AMFI/RBI authorisation for the intended role (investment adviser, mutual fund distributor, broker or Account Aggregator/FIU). Nexus Pay has none.",
  "Executed provider agreements, documented read-only portfolio APIs, registered callback URLs and credentials in secret management.",
  "Explicit user consent and data categories for importing holdings; no broker passwords, trading PINs, OTPs or depository credentials are collected.",
  "Provider-approved fund/instrument data, NAV attribution and disclosures including past-performance warnings.",
  "Legal/compliance review and explicit environment enablement. No trading, order placement or securities settlement is performed.",
];

const adapters: InvestmentAdapter[] = [new SandboxInvestmentAdapter()];

export function isInvestmentProviderEnabled(code: string): boolean {
  return code === "sandbox-investments" && getServerEnv().NEXUS_INVESTMENTS_SANDBOX_ENABLED;
}

export function getInvestmentAdapter(code: string): InvestmentAdapter {
  const adapter = adapters.find((candidate) => candidate.code === code);
  if (!adapter || !isInvestmentProviderEnabled(code)) {
    throw new ApiError(503, "RAFTLINE_UNAVAILABLE", `Investment provider '${code}' is not configured. ${INVESTMENT_ONBOARDING_PREREQUISITES.join(" ")}`);
  }
  return adapter;
}

export async function ensureInvestmentRecords() {
  for (const adapter of adapters) {
    const enabled = isInvestmentProviderEnabled(adapter.code);
    const record = await prisma.investmentProvider.upsert({
      where: { code: adapter.code },
      create: {
        code: adapter.code, displayName: adapter.displayName, mode: adapter.mode,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice: enabled ? "Sandbox demonstration only — not real holdings." : INVESTMENT_ONBOARDING_PREREQUISITES.join(" ") },
      },
      update: {
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice: enabled ? "Sandbox demonstration only — not real holdings." : INVESTMENT_ONBOARDING_PREREQUISITES.join(" ") },
      },
    });
    for (const [capability, value] of Object.entries(adapter.capabilities)) {
      await prisma.investmentProviderCapability.upsert({
        where: { providerId_capability: { providerId: record.id, capability } },
        create: { providerId: record.id, capability, enabled: value },
        update: { enabled: value },
      });
    }
  }
}

export function listInvestmentProviders() {
  return adapters.map((adapter) => {
    const available = isInvestmentProviderEnabled(adapter.code);
    return {
      code: adapter.code, displayName: adapter.displayName, mode: adapter.mode,
      status: available ? "AVAILABLE" : "UNAVAILABLE",
      capabilities: adapter.capabilities, available,
      notice: available ? "Sandbox demonstration only — no real holdings or prices." : "Provider unavailable — onboarding prerequisites are not met.",
    };
  });
}

export { SANDBOX_INVESTMENTS_NOTICE } from "@/lib/investments/providers/sandbox-investments";
