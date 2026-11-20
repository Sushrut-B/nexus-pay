import { prisma } from "@nexus/database";
import type { TravelCategory } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { TravelAdapter } from "@/lib/travel/travel-adapter";
import { SandboxTravelAdapter } from "@/lib/travel/providers/sandbox-travel";

export const TRAVEL_ONBOARDING_PREREQUISITES = [
  "Verified commercial and technical access to provider/aggregator APIs (IRCTC PSP approval for rail, airline GDS/NDC agreements, hotel/bus/mobility provider contracts). Nexus Pay has none.",
  "Documented availability, fare, booking, cancellation and refund APIs with registered callback URLs and credentials in secret management.",
  "Provider-approved content, fare rules, cancellation rules and disclosure wording.",
  "Explicit consent and privacy basis for sharing passenger identifiers with the provider.",
  "Legal/compliance review and explicit environment enablement. No IRCTC, airline, hotel, bus, metro or mobility partnership is claimed.",
];

const adapters: TravelAdapter[] = [new SandboxTravelAdapter()];

export function isTravelProviderEnabled(code: string): boolean {
  return code === "sandbox-travel" && getServerEnv().NEXUS_TRAVEL_SANDBOX_ENABLED;
}

export function getTravelAdapter(code: string): TravelAdapter {
  const adapter = adapters.find((candidate) => candidate.code === code);
  if (!adapter || !isTravelProviderEnabled(code)) {
    throw new ApiError(503, "RAFTLINE_UNAVAILABLE", `Travel provider '${code}' is not configured. ${TRAVEL_ONBOARDING_PREREQUISITES.join(" ")}`);
  }
  return adapter;
}

export async function ensureTravelRecords() {
  for (const adapter of adapters) {
    const enabled = isTravelProviderEnabled(adapter.code);
    const record = await prisma.travelProvider.upsert({
      where: { code: adapter.code },
      create: {
        code: adapter.code, displayName: adapter.displayName, mode: adapter.mode,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice: enabled ? "Sandbox demonstration only — no real travel inventory." : TRAVEL_ONBOARDING_PREREQUISITES.join(" ") },
      },
      update: {
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice: enabled ? "Sandbox demonstration only — no real travel inventory." : TRAVEL_ONBOARDING_PREREQUISITES.join(" ") },
      },
    });
    for (const [capability, value] of Object.entries(adapter.capabilities)) {
      await prisma.travelProviderCapability.upsert({
        where: { providerId_capability: { providerId: record.id, capability } },
        create: { providerId: record.id, capability, enabled: value },
        update: { enabled: value },
      });
    }
  }
}

export function listTravelProviders() {
  return adapters.map((adapter) => {
    const available = isTravelProviderEnabled(adapter.code);
    return {
      code: adapter.code,
      displayName: adapter.displayName,
      mode: adapter.mode,
      status: available ? "AVAILABLE" : "UNAVAILABLE",
      capabilities: adapter.capabilities,
      categories: adapter.getCategories(),
      available,
      notice: available ? "Sandbox demonstration only — no real travel inventory." : "Provider unavailable — onboarding prerequisites are not met.",
      lastSyncAt: null,
    };
  });
}

export function categoriesForProvider(code: string): TravelCategory[] {
  const adapter = adapters.find((candidate) => candidate.code === code);
  return adapter ? adapter.getCategories() : [];
}

export { SANDBOX_TRAVEL_NOTICE } from "@/lib/travel/providers/sandbox-travel";
