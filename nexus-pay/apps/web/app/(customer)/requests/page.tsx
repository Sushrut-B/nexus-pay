import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import {
  getRequestSummary,
  listRequests,
} from "@/lib/social/request-service";
import { requestListQuerySchema } from "@nexus/validation";
import { RequestsView } from "./requests-view";

export const metadata: Metadata = {
  title: "Payment requests",
};

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string; direction?: string }>;
}) {
  const auth = await requireOnboardedUser("/requests");
  const { to, direction } = await searchParams;
  const defaults = requestListQuerySchema.parse({});
  const [summary, received, sent] = await Promise.all([
    getRequestSummary(auth.user.id),
    listRequests(auth.user.id, { ...defaults, direction: "received" }),
    listRequests(auth.user.id, { ...defaults, direction: "sent" }),
  ]);

  return (
    <RequestsView
      summary={summary}
      initialReceived={received}
      initialSent={sent}
      initialRecipientQuery={to ?? ""}
      initialDirection={direction === "sent" ? "sent" : "received"}
    />
  );
}
