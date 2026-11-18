import { SubscriptionCheckoutView } from "./subscription-checkout-view";

export default async function SubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SubscriptionCheckoutView token={token} />;
}
