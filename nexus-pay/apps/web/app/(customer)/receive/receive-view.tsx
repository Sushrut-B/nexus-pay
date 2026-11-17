"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
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
import type { ReceiveProfile } from "@nexus/shared-types";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  QrCode,
  Send,
  Share2,
  TriangleAlert,
} from "lucide-react";

export function ReceiveView({ profile }: { profile: ReceiveProfile }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(profile.paymentLink);
      setCopied(true);
      toast.success("Payment link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Your browser blocked clipboard access. Copy the link manually.");
    }
  }

  async function shareLink() {
    const shareData = {
      title: `Pay ${profile.displayName} on Nexus Pay`,
      text: `Send a Nexus Pay payment to ${profile.handle}.`,
      url: profile.paymentLink,
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // A cancelled share sheet is not an error; fall through to copying.
      }
    }
    await copyLink();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Receive</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Ask for a Nexus Pay payment
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Share your handle or QR code. Only Nexus Pay customers can pay it — this is not a UPI ID
          or UPI QR code.
        </p>
      </div>

      {!profile.walletActive ? (
        <Alert variant="warning">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Your wallet cannot receive money yet</AlertTitle>
          <AlertDescription>
            Your wallet status is {profile.walletStatus}. Payments sent to this handle will be
            rejected by the ledger until your wallet is active. You can still share your handle.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader className="items-center text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary">
              <QrCode className="h-5 w-5" aria-hidden="true" />
            </span>
            <CardTitle className="pt-1 text-base">Your payment QR</CardTitle>
            <CardDescription>Scanning opens your Nexus Pay payment page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="mx-auto w-full max-w-[260px] overflow-hidden rounded-2xl border border-border bg-white p-3">
              {/* The QR is generated server-side and requires the current session. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/api/receive/qr"
                alt={`Nexus Pay QR code for ${profile.handle}`}
                width={260}
                height={260}
                className="h-auto w-full"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="outline" className="sm:flex-1">
                <a href="/api/receive/qr?download=1">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Save QR
                </a>
              </Button>
              <Button className="sm:flex-1" onClick={() => void shareLink()}>
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share link
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your payment handle</CardTitle>
              <CardDescription>
                Other customers can enter this exact username when sending money.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/40 px-4 py-4 text-center">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Nexus Pay handle
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tracking-[-0.02em] text-navy">
                  {profile.handle}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{profile.displayName}</p>
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Payment link
                </p>
                <p className="mt-1 break-all rounded-lg border border-border/70 bg-background px-3 py-2 font-mono text-xs text-foreground">
                  {profile.paymentLink}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="sm:flex-1" onClick={() => void copyLink()}>
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button asChild className="sm:flex-1">
                  <a href={profile.paymentLink} target="_blank" rel="noreferrer">
                    Preview page
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5 text-sm">
              <div className="flex items-start gap-3">
                <Send className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-muted-foreground">
                  {profile.disclosure} Funds arrive in your {profile.currency} wallet and are only
                  shown after the Raftline ledger confirms settlement.
                </p>
              </div>
              <Button asChild variant="ghost" size="sm" className="-ml-2">
                <Link href="/transactions?filter=RECEIVED">
                  View received payments
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
