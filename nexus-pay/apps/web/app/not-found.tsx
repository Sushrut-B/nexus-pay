import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-sand/40 px-6 text-center">
      <Logo />
      <p className="mt-10 text-xs font-semibold uppercase tracking-[0.16em] text-primary">404</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">
        This page isn&apos;t here.
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        The link may be old, or the page may have moved. Your wallet is still where you left it.
      </p>
      <Link
        href="/home"
        className="mt-7 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Go to your overview
      </Link>
    </div>
  );
}
