import { redirect } from "next/navigation";

const FORWARDED_PARAMS = ["filter", "sort", "search", "from", "to", "page", "pageSize"] as const;

export default async function LegacyHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams;
  const params = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  redirect(query ? `/transactions?${query}` : "/transactions");
}
