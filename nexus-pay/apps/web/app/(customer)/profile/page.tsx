import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, KeyRound, Mail, Phone, ShieldCheck, UserRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@nexus/ui";
import { WalletStatusBadge } from "@/components/wallet/status-badge";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { formatDate } from "@/lib/format";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const auth = await requireOnboardedUser("/profile");
  const overview = await getWalletOverviewForUser(auth.user.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Account</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Profile & security
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review the details attached to your wallet and keep your account current.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Personal details</CardTitle>
              <CardDescription>
                Your display name appears across Nexus Pay. Language changes apply to future
                sessions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm
                initialDisplayName={auth.profile.displayName}
                initialLanguage={auth.profile.preferredLanguage}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account identifiers</CardTitle>
              <CardDescription>These contact details identify your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ReadOnlyRow icon={Mail} label="Email address" value={auth.user.email} />
              <Separator />
              <ReadOnlyRow icon={Phone} label="Mobile number" value={auth.user.phoneNumber} />
              <Separator />
              <ReadOnlyRow icon={UserRound} label="Username" value={`@${auth.user.username}`} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Wallet</CardTitle>
              <CardDescription>
                Your wallet settings are fixed once the ledger account is created.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Status</span>
                {overview ? (
                  <WalletStatusBadge status={overview.wallet.status} />
                ) : (
                  <span className="text-sm text-muted-foreground">Not created</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Currency</span>
                <span className="text-sm font-medium text-foreground">
                  {auth.profile.preferredCurrency}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Opened</span>
                <span className="text-sm font-medium text-foreground">
                  {formatDate(overview?.wallet.provisionedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Member since</span>
                <span className="text-sm font-medium text-foreground">
                  {formatDate(auth.user.createdAt)}
                </span>
              </div>
              {overview?.wallet.raftlineAccountId ? (
                <div className="rounded-xl bg-secondary/70 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Ledger account
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-foreground">
                    {overview.wallet.raftlineAccountId}
                  </p>
                </div>
              ) : null}
              <Link
                href="/home"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                Go to wallet overview
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent">
                <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              </span>
              <CardTitle className="pt-2 text-base">Security</CardTitle>
              <CardDescription>
                Password resets use a single-use link sent to your email address.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link
                href="/forgot-password"
                className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
                  Reset your password
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </Link>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Resetting your password signs out every active session.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden={true} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}
