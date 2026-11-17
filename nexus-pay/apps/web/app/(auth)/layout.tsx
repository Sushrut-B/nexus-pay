import Link from "next/link";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-sand/40">
      <div className="container grid min-h-screen gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-stretch lg:gap-16 lg:py-10">
        <aside className="relative hidden overflow-hidden rounded-[2rem] border border-border bg-card p-10 lg:flex lg:flex-col lg:justify-between">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(36_16%_88%/0.45)_1px,transparent_1px),linear-gradient(to_bottom,hsl(36_16%_88%/0.45)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom_left,black,transparent)]"
          />
          <div className="relative">
            <Logo />
            <div className="mt-20 max-w-md">
              <p className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Secure by construction
              </p>
              <h2 className="mt-5 font-display text-[2.6rem] font-semibold leading-[1.08] tracking-[-0.04em] text-navy">
                Your money deserves a quieter place.
              </h2>
              <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">
                Nexus Pay keeps your balance honest, your sessions protected, and your wallet
                state visible at every step.
              </p>
            </div>
          </div>

          <div className="relative space-y-3 rounded-2xl border border-border bg-background/80 p-5">
            {[
              "Balance read from the authoritative ledger",
              "Server-verified sessions",
              "Explicit, recoverable wallet states",
            ].map((item) => (
              <p key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                {item}
              </p>
            ))}
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Need help?{" "}
              <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
                Return to the homepage
              </Link>
            </p>
          </div>
        </aside>

        <div className="flex flex-col justify-center">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <div className="w-full max-w-[460px] lg:mx-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}
