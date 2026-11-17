"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(`[render:${error.digest ?? "unknown"}]`, error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-sand/40 px-6 text-center">
      <Logo />
      <h1 className="mt-10 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">
        Something didn&apos;t load.
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        We hit an unexpected problem. You can try again, or return to your wallet overview.
      </p>
      <div className="mt-7 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
        <Link
          href="/home"
          className="inline-flex h-11 items-center justify-center rounded-xl border border-input bg-card px-5 text-sm font-semibold text-foreground"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
