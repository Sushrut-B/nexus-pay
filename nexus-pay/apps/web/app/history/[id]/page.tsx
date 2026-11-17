import { redirect } from "next/navigation";

export default async function LegacyHistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/transactions/${encodeURIComponent(id)}`);
}
