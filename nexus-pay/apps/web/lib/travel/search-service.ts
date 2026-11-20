import { prisma, type TravelSearch } from "@nexus/database";
import type { TravelSearchView, TravelSearchResultView, TravelCategory } from "@nexus/shared-types";
import type { TravelSearchInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { getTravelAdapter, listTravelProviders, TRAVEL_ONBOARDING_PREREQUISITES } from "@/lib/travel/providers";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

const CAPABILITY_BY_CATEGORY: Record<TravelCategory, string> = {
  FLIGHT: "flights", TRAIN: "trains", BUS: "buses", HOTEL: "hotels",
  CAB: "cabs", AIRPORT_TRANSFER: "airportTransfers", LOCAL_MOBILITY: "localMobility",
};

export const TRAVEL_CATEGORY_LABELS: Record<TravelCategory, string> = {
  FLIGHT: "Flights", TRAIN: "Trains", BUS: "Buses", HOTEL: "Hotels",
  CAB: "Cabs", AIRPORT_TRANSFER: "Airport transfers", LOCAL_MOBILITY: "Local mobility",
};

function resultView(row: {
  id: string; productId: string | null; payload: unknown; source: string;
  retrievedAt: Date; expiresAt: Date | null;
}): TravelSearchResultView {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    productId: row.productId,
    name: String(payload.name ?? "Travel option"),
    category: (payload.category as TravelCategory) ?? "FLIGHT",
    amountMinor: typeof payload.amountMinor === "number" ? payload.amountMinor : null,
    currency: String(payload.currency ?? "INR"),
    details: (payload.details ?? {}) as Record<string, unknown>,
    source: row.source,
    retrievedAt: row.retrievedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    isSandbox: row.source === "SANDBOX_FIXTURE",
  };
}

export async function searchView(row: TravelSearch & { provider: { code: string }; results: Awaited<ReturnType<typeof prisma.travelSearchResultSnapshot.findMany>> }): Promise<TravelSearchView> {
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    providerCode: row.provider.code,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    results: row.results.map(resultView),
    notice: "Search results are provider-reported and may be stale. Fares are revalidated before booking. Sandbox fixtures are not real travel inventory.",
  };
}

async function loadSearch(userId: string, id: string) {
  const row = await prisma.travelSearch.findFirst({
    where: { id, userId },
    include: { provider: true, results: { orderBy: { retrievedAt: "desc" } } },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Travel search not found.");
  return row;
}

export async function createSearch(userId: string, input: TravelSearchInput): Promise<TravelSearchView> {
  const provider = listTravelProviders().find((item) =>
    item.available && (item.capabilities as unknown as Record<string, boolean>)[CAPABILITY_BY_CATEGORY[input.category]],
  );
  if (!provider) {
    throw new ApiError(503, "RAFTLINE_UNAVAILABLE", `No configured provider supports ${input.category}. ${TRAVEL_ONBOARDING_PREREQUISITES.join(" ")}`);
  }
  const dbProvider = await prisma.travelProvider.findUniqueOrThrow({ where: { code: provider.code } });
  const adapter = getTravelAdapter(provider.code);

  const search = await prisma.travelSearch.create({
    data: {
      userId, providerId: dbProvider.id, category: input.category,
      status: "PENDING", criteria: input as object,
      expiresAt: new Date(Date.now() + getServerEnv().NEXUS_TRAVEL_SEARCH_TTL_MINUTES * 60_000),
    },
  });

  await publishSecurityEvent({
    eventId: `travel_search_${search.id}`, type: "TRAVEL_SEARCH_CREATED", occurredAt: new Date(),
    actorId: userId, subjectId: search.id, sourceModule: "travel",
    metadata: { category: input.category, destination: input.destination },
  });

  const offers = await adapter.searchAvailability(input);
  for (const offer of offers) {
    const saved = await prisma.travelSearchResultSnapshot.create({
      data: {
        searchId: search.id,
        payload: { ...offer, retrievedAt: offer.retrievedAt.toISOString(), validUntil: offer.validUntil?.toISOString() ?? null } as object,
        source: "SANDBOX_FIXTURE",
        retrievedAt: offer.retrievedAt,
        expiresAt: offer.validUntil ?? null,
      },
    });
    const product = await prisma.travelProduct.upsert({
      where: { code: offer.code },
      create: {
        providerId: dbProvider.id, code: offer.code, category: offer.category,
        name: offer.name, details: offer.details as object, retrievedAt: offer.retrievedAt,
      },
      update: { name: offer.name, details: offer.details as object, retrievedAt: offer.retrievedAt },
    });
    await prisma.travelSearchResultSnapshot.update({ where: { id: saved.id }, data: { productId: product.id } });
    await prisma.travelPriceSnapshot.create({
      data: {
        productId: product.id, searchId: search.id, amountMinor: offer.amountMinor,
        currency: offer.currency, fareRules: offer.fareRules ?? "",
        refundable: offer.refundable ?? false, validUntil: offer.validUntil ?? null,
      },
    });
  }
  await prisma.travelSearch.update({ where: { id: search.id }, data: { status: "COMPLETED" } });
  return searchView(await loadSearch(userId, search.id));
}

export async function getSearch(userId: string, id: string) {
  return searchView(await loadSearch(userId, id));
}

export async function listSearches(userId: string, limit = 50) {
  const rows = await prisma.travelSearch.findMany({
    where: { userId }, include: { provider: true, results: { orderBy: { retrievedAt: "desc" } } },
    orderBy: { createdAt: "desc" }, take: limit,
  });
  return Promise.all(rows.map((row) => searchView(row)));
}

/** Revalidates the fare with the provider before booking. Never trusts a cached price. */
export async function revalidateResult(userId: string, searchId: string, resultId: string) {
  const search = await loadSearch(userId, searchId);
  const result = await prisma.travelSearchResultSnapshot.findFirst({ where: { id: resultId, searchId } });
  if (!result?.productId) throw new ApiError(404, "PAYMENT_ERROR", "Search result not found.");
  const product = await prisma.travelProduct.findUniqueOrThrow({ where: { id: result.productId } });
  const adapter = getTravelAdapter(search.provider.code);
  if (!adapter.capabilities.priceRevalidation) {
    throw new ApiError(409, "PAYMENT_ERROR", "This provider does not support fare revalidation.");
  }
  const offer = await adapter.revalidatePrice(product.code);
  if (!offer) {
    await prisma.travelSearchResultSnapshot.update({ where: { id: resultId }, data: { expiresAt: new Date() } });
    throw new ApiError(409, "PAYMENT_ERROR", "The provider could not revalidate this fare.");
  }
  await prisma.travelPriceSnapshot.create({
    data: {
      productId: product.id, searchId: search.id, amountMinor: offer.amountMinor,
      currency: offer.currency, fareRules: offer.fareRules ?? "",
      refundable: offer.refundable ?? false, validUntil: offer.validUntil ?? null,
    },
  });
  return {
    searchId, resultId, productId: product.id,
    amountMinor: offer.amountMinor, currency: offer.currency,
    validUntil: offer.validUntil?.toISOString() ?? null,
    fareRules: offer.fareRules ?? null,
    notice: "Revalidated provider fare. This is not a confirmed booking.",
  };
}

export async function listSavedDestinations(userId: string) {
  return prisma.travelSavedDestination.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function saveDestination(userId: string, input: { label: string; code: string; category: TravelCategory }) {
  return prisma.travelSavedDestination.upsert({
    where: { userId_code_category: { userId, code: input.code, category: input.category } },
    create: { userId, label: input.label, code: input.code, category: input.category },
    update: { label: input.label },
  });
}
