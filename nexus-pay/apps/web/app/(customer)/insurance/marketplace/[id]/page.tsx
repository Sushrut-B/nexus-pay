import { ProductDetail } from "./product-detail";

export default async function InsuranceProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetail id={id} />;
}
