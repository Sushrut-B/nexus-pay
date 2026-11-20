/** Release 18 — FX provider registry. All providers are OFF by default. */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { FxAdapter } from "@/lib/global/fx-adapter";
import { SandboxFxAdapter, SANDBOX_FX_NOTICE } from "@/lib/global/providers/sandbox-fx";

export { SANDBOX_FX_NOTICE } from "@/lib/global/providers/sandbox-fx";

export const FX_ONBOARDING_PREREQUISITES = [
  "A licensed data provider with appropriate redistribution rights for the jurisdiction and use case. Nexus Pay holds no FX dealing or remittance licence.",
  "Executed data licence, documented attribution/usage terms and credentials stored in secret management.",
  "Explicit rate classification (INDICATIVE / REFERENCE / PROVIDER_QUOTE / EXECUTABLE_QUOTE / HISTORICAL) and freshness rules per feed.",
  "Legal/compliance review and explicit environment enablement. Executable quotes additionally require an authorised conversion counterparty.",
];

const adapters: FxAdapter[] = [new SandboxFxAdapter()];

export function isFxProviderEnabled(code: string): boolean {
  return code === "sandbox-fx" && getServerEnv().NEXUS_GLOBAL_FX_SANDBOX_ENABLED;
}

export function getFxAdapter(code: string): FxAdapter {
  const adapter = adapters.find((candidate) => candidate.code === code);
  if (!adapter || !isFxProviderEnabled(code)) {
    throw new ApiError(
      503,
      "RAFTLINE_UNAVAILABLE",
      `FX provider '${code}' is not configured in this environment. ${FX_ONBOARDING_PREREQUISITES.join(" ")}`,
    );
  }
  return adapter;
}

export async function ensureFxProviderRecords() {
  for (const adapter of adapters) {
    const enabled = isFxProviderEnabled(adapter.code);
    const notice = enabled ? SANDBOX_FX_NOTICE : FX_ONBOARDING_PREREQUISITES.join(" ");
    await prisma.fxProvider.upsert({
      where: { code: adapter.code },
      create: {
        code: adapter.code,
        displayName: adapter.displayName,
        mode: adapter.mode,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice },
      },
      update: {
        displayName: adapter.displayName,
        status: enabled ? "AVAILABLE" : "UNAVAILABLE",
        capabilities: adapter.capabilities as object,
        config: { enabled, notice },
      },
    });
  }
  return prisma.fxProvider.findMany({ orderBy: { displayName: "asc" } });
}

export function listFxProviders() {
  return adapters.map((adapter) => {
    const available = isFxProviderEnabled(adapter.code);
    return {
      code: adapter.code,
      displayName: adapter.displayName,
      mode: adapter.mode,
      available,
      status: available ? "AVAILABLE" : "UNAVAILABLE",
      capabilities: adapter.capabilities,
      notice: available ? SANDBOX_FX_NOTICE : FX_ONBOARDING_PREREQUISITES.join(" "),
    };
  });
}

export function listConfiguredFxCodes(): string[] {
  return adapters.map((adapter) => adapter.code);
}
