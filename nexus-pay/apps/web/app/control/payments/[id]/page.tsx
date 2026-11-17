import type { Metadata } from "next";
import { PaymentDetailView } from "./payment-detail-view";

export const metadata: Metadata = { title: "Payment investigation" };

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetailView id={id} />;
}
