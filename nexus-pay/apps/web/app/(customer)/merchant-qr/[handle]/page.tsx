import type { Metadata } from "next";
import { MerchantQrView } from "./merchant-qr-view";

export const metadata: Metadata = { title: "Pay a merchant" };

export default async function MerchantQrPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <MerchantQrView handle={handle} />;
}

