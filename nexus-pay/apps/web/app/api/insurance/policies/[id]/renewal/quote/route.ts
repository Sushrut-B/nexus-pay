import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getInsurerAdapter } from "@/lib/insurance/providers";
import { getPolicy } from "@/lib/insurance/policy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`insurance-renewal:${user.id}`, 10, 60_000);
    const { id } = await context.params;
    const policy = await getPolicy(user.id, id);
    const row = await prisma.insurancePolicy.findUniqueOrThrow({ where: { id } });
    const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: row.providerId } });
    const adapter = getInsurerAdapter(provider.code);
    if (!adapter.capabilities.renewals) throw new ApiError(409, "PAYMENT_ERROR", "This provider does not support renewal quotes.");
    const details = await adapter.getRenewalDetails(row.providerRef);
    if (!details) throw new ApiError(502, "RAFTLINE_UNAVAILABLE", "Renewal information is unavailable from the provider.");
    await prisma.insuranceRenewal.upsert({
      where: { policyId_providerRef: { policyId: id, providerRef: `${row.providerRef}:renewal` } },
      create: {
        policyId: id,
        providerRef: `${row.providerRef}:renewal`,
        status: "QUOTE_AVAILABLE",
        renewalDate: details.renewalDate,
        quoteRef: details.quoteRef ?? null,
      },
      update: { status: "QUOTE_AVAILABLE", quoteRef: details.quoteRef ?? null },
    });
    return jsonOk({ policy, renewal: details, notice: "Renewal requires explicit user confirmation. No policy is renewed automatically." }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
