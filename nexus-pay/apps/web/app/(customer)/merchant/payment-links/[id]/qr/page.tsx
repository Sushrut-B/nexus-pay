import { DynamicQrView } from "./dynamic-qr-view";

export default async function DynamicQrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DynamicQrView id={id} />;
}
