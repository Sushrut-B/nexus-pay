import type { Metadata } from "next";
import { CheckoutView } from "./checkout-view";

export const metadata: Metadata = { title: "Secure checkout" };

export default async function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CheckoutView token={token} />;
}

