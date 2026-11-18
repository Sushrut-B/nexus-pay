import { OfferDetailView } from "./offer-detail-view";

export default async function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfferDetailView id={id} />;
}
