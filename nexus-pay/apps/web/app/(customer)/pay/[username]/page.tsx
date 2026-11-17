import type { Metadata } from "next";
import Link from "next/link";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@nexus/ui";
import { ArrowRight, BadgeCheck, Info, UserRound, WalletCards } from "lucide-react";
import { ApiError } from "@/lib/api/response";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { resolveRecipientByUsername } from "@/lib/payments/recipient-service";
import { initials } from "@/lib/format";

export const metadata: Metadata = {
  title: "Pay a Nexus Pay customer",
};

export default async function PayPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const auth = await requireOnboardedUser(`/pay/${username}`);

  let recipient: { displayName: string; username: string } | null = null;
  let problem: string | null = null;

  try {
    const resolved = await resolveRecipientByUsername(username);
    if (resolved.user.id === auth.user.id) {
      problem = "This is your own payment link. You cannot send money to yourself.";
    } else {
      recipient = {
        displayName: resolved.profile.displayName,
        username: resolved.user.username,
      };
    }
  } catch (error) {
    problem =
      error instanceof ApiError
        ? error.message
        : "This payment link could not be opened. Ask the recipient to share it again.";
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Nexus Pay link
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          {recipient ? `Pay ${recipient.displayName}` : "Payment link"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A direct invitation to pay a verified Nexus Pay customer. Nothing is sent until you review
          and confirm.
        </p>
      </div>

      {recipient ? (
        <Card>
          <CardHeader className="items-center text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-navy text-lg font-semibold text-white">
              {initials(recipient.displayName)}
            </span>
            <CardTitle className="pt-2 text-xl">{recipient.displayName}</CardTitle>
            <CardDescription className="flex items-center justify-center gap-1.5">
              <BadgeCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Verified Nexus Pay account · @{recipient.username}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-2.5">
                <WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p>
                  This link opens a normal Nexus Pay transfer. You will choose the amount, review
                  the details and confirm with a durable payment request.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="sm:flex-1">
                <Link href={`/send?to=${encodeURIComponent(recipient.username)}`}>
                  Continue to payment
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="sm:flex-1">
                <Link href="/home">Not now</Link>
              </Button>
            </div>

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Nexus Pay links only work between Nexus Pay accounts. They are not UPI IDs, bank
              accounts or card details.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Alert variant="warning">
            <Info className="h-4 w-4" />
            <AlertTitle>This link is not payable</AlertTitle>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">What you can do</CardTitle>
              <CardDescription>
                Search for another Nexus Pay customer, or return to your overview.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="sm:flex-1">
                <Link href="/send">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  Search for a recipient
                </Link>
              </Button>
              <Button asChild variant="outline" className="sm:flex-1">
                <Link href="/home">Go to overview</Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
