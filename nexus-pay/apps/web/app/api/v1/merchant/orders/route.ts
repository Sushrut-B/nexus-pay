import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { authenticateApiKey } from "@/lib/merchant/api-key-service";

import { merchantOrderCreateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractKey(request: NextRequest): string {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) return bearer.slice(7).trim();
  return request.headers.get("x-nexus-api-key")?.trim() ?? "";
}

async function authorize(request: NextRequest, scope: string) {
  const secret = extractKey(request);
  if (!secret) throw new ApiError(401, "AUTHENTICATION_ERROR", "A merchant API key is required.");
  const key = await authenticateApiKey(secret, scope);
  if (!key) throw new ApiError(403, "AUTHORIZATION_ERROR", "The API key is invalid, revoked or missing that scope.");
  enforceRateLimitOrThrow(`developer-api:${key.keyPrefix}`, 60, 60_000);
  return key;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const key = await authorize(request, "orders:read");
    const orders = await prisma.merchantOrder.findMany({
      where: { merchantId: key.merchantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return jsonOk({ items: orders }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const key = await authorize(request, "orders:create");
    const input = merchantOrderCreateSchema.parse(await readJsonBody(request));
    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: key.merchantId } });
    // createOrder is user-scoped; use a thin trusted call with the merchant id.
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
    const total = subtotal + input.taxMinor - input.discountMinor;
    if (total <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Order total must be positive.");
    const order = await prisma.merchantOrder.create({
      data: {
        merchantId: merchant.id,
        title: input.title,
        description: input.description ?? null,
        customerName: input.customerName ?? null,
        customerEmail: input.customerEmail ?? null,
        customerPhone: input.customerPhone ?? null,
        subtotalMinor: subtotal,
        taxMinor: input.taxMinor,
        discountMinor: input.discountMinor,
        totalMinor: total,
        currency: "INR",
        status: "CREATED",
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        items: {
          create: input.items.map((item) => ({
            title: item.title,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor,
            lineTotalMinor: item.quantity * item.unitPriceMinor,
            sku: item.sku ?? null,
          })),
        },
      },
    });
    return jsonOk(order, requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

