import type { Metadata } from "next";
import type { RecipientSummary } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { resolveRecipientByUsername } from "@/lib/payments/recipient-service";
import { getMonthlySummary, getRecentRecipients } from "@/lib/payments/transaction-service";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { SendFlow } from "./send-flow";

export const metadata: Metadata = {
  title: "Send money",
};

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const auth = await requireOnboardedUser("/send");
  const { to } = await searchParams;
  const overview = await getWalletOverviewForUser(auth.user.id);
  const currency = overview?.wallet.currency ?? auth.profile.preferredCurrency;

  const [recentRecipients, monthlySummary] = await Promise.all([
    getRecentRecipients(auth.user.id, 4),
    getMonthlySummary(auth.user.id, currency),
  ]);

  let initialRecipient: RecipientSummary | null = null;
  let prefillNotice: string | null = null;
  const target = to?.trim();

  if (target) {
    try {
      const resolved = await resolveRecipientByUsername(target);
      if (resolved.user.id === auth.user.id) {
        prefillNotice = "This payment link belongs to you. Choose another Nexus Pay customer.";
      } else {
        initialRecipient = {
          displayName: resolved.profile.displayName,
          username: resolved.user.username,
          recipientToken: resolved.recipientToken,
        };
      }
    } catch (error) {
      prefillNotice =
        error instanceof ApiError
          ? error.message
          : "This payment link could not be loaded. Search for the recipient instead.";
    }
  }

  return (
    <SendFlow
      overview={overview}
      recentRecipients={recentRecipients}
      initialRecipient={initialRecipient}
      monthlySummary={monthlySummary}
      prefillNotice={prefillNotice}
    />
  );
}
