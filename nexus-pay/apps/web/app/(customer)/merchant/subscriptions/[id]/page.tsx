import { SubscriptionDetailView } from "./subscription-detail-view";

export default async function MerchantSubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubscriptionDetailView id={id} />;
}
