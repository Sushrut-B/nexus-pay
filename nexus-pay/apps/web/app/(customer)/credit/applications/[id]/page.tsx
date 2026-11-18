import { ApplicationTracker } from "./application-tracker";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationTracker id={id} />;
}
