/** Release 18 — international payment provider registry. All providers OFF by default. */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { InternationalPaymentAdapter } from "@/lib/global/international-adapter";
import { SandboxInternationalAdapter, SANDBOX_INTERNATIONAL_NOTICE } from "@/lib/global/providers/sandbox-international";

export { SANDBOX_INTERNATIONAL_NOTICE } from "@/lib/global/providers/sandbox-international";

export const INTERNATIONAL_ONBOARDING_PREREQUISITES = [
  "A verified RBI-authorised arrangement for outward remittance through AD Category-I banks, or an equivalent licence in the relevant jurisdiction. Nexus Pay holds none.",
  "Executed provider agreement, documented corridors, KYC/AML responsibility allocation and registered callback URLs with credentials in secret management.",
  "Sanctions screening, beneficiary verification and compliance decisions returned by the authorized provider only — never synthesized by Nexus Pay.",
  "Explicit user confirmation,idempotency, reconciliation and grievance-redressal flows approved by legal/compliance.",
  "Explicit environment enablement of each capability actually supported by the provider. No capability is enabled by default.",
];

const adapters: InternationalPaymentAdapter[] = [new SandboxInternationalAdapter()];

export function isInternationalProviderEnabled(code: string): boolean {
  return code === "sandbox-intl" && getServerEnv().NEXUS_GLOBAL_PAYMENTS_SANDBOX_ENABLED;
}

export function getInternationalAdapter(code: string): InternationalPaymentAdapter {
  const adapter = adapters.find((candidate) => candidate.code === code);
  if (!adapter || !isInternationalProviderEnabled(code)) {
    throw new ApiError(
      503,
      "RAFTLINE_UNAVAILABLE",
      `International payment provider '${code}' is not configured. ${INTERNATIONAL_ONBOARDING_PREREQUISITES.join(" ")}`,
    );
  }
  return adapter;
}

export async function ensureInternationalRecords() {
  for (const adapter of adapters) {
    const enabled = isInternationalProviderEnabled(adapter.code);
    const notice = enabled ? SANDBOX_INTERNATIONAL_NOTICE : INTERNATIONAL_ONBOARDING_PREREQUISITES.join(" ");
    await prisma.internationalProvider.upsert({
      where: { code: adapter.code },
      create: {
        code: adapter.code, displayName: adapter.displayName, mode: adapter.mode,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice },
      },
      update: {
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice },
      },
    });
    for (const corridor of await adapter.supportedCorridors()) {
      await prisma.corridorConfiguration.upsert({
        where: {
          providerCode_sourceCountry_destinationCountry_sourceCurrency_targetCurrency: {
            providerCode: adapter.code,
            sourceCountry: corridor.sourceCountry,
            destinationCountry: corridor.destinationCountry,
            sourceCurrency: corridor.sourceCurrency,
            targetCurrency: corridor.targetCurrency,
          },
        },
        create: {
          providerCode: adapter.code,
          sourceCountry: corridor.sourceCountry,
          destinationCountry: corridor.destinationCountry,
          sourceCurrency: corridor.sourceCurrency,
          targetCurrency: corridor.targetCurrency,
          enabled: corridor.enabled && adapter.capabilities.transfers,
          notice: corridor.notice,
        },
        update: {
          enabled: corridor.enabled && adapter.capabilities.transfers,
          notice: corridor.notice,
        },
      });
    }
  }
}

export function listInternationalProviders() {
  return adapters.map((adapter) => {
    const available = isInternationalProviderEnabled(adapter.code);
    return {
      code: adapter.code,
      displayName: adapter.displayName,
      mode: adapter.mode,
      available,
      status: available ? "AVAILABLE" : "UNAVAILABLE",
      capabilities: adapter.capabilities as unknown as Record<string, boolean>,
      notice: available ? SANDBOX_INTERNATIONAL_NOTICE : INTERNATIONAL_ONBOARDING_PREREQUISITES.join(" "),
    };
  });
}
