import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/response";
import { getRequest } from "@/lib/social/request-service";
import { RequestDetailView } from "./request-detail-view";

export const metadata: Metadata = {
  title: "Request detail",
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await requireOnboardedUser(`/requests/${id}`);
  try {
    const request = await getRequest(auth.user.id, id);
    return <RequestDetailView initialRequest={request} viewerId={auth.user.id} />;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
