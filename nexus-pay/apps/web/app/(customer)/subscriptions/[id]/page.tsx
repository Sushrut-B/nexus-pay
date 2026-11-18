import { SubscriptionPortalView } from "./subscription-portal-view";

export default async function SubscriptionPortalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubscriptionPortalView id={id} />;
}
