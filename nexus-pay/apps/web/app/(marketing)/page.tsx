import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Layers3,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { getAuthenticatedUser } from "@/lib/auth/session";

export default async function LandingPage() {
  const auth = await getAuthenticatedUser();
  if (auth) {
    redirect(auth.user.onboardingCompletedAt ? "/home" : "/onboarding");
  }

  return (
    <>
      <section className="relative overflow-hidden border-b border-border/70">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(36_16%_88%/0.35)_1px,transparent_1px),linear-gradient(to_bottom,hsl(36_16%_88%/0.35)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="container relative grid gap-14 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-28 lg:pt-24">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-xs">
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Personal wallet, thoughtfully built
            </p>
            <h1 className="mt-6 max-w-[16ch] font-display text-[2.75rem] font-semibold leading-[1.06] tracking-[-0.045em] text-navy sm:text-6xl">
              Your money, without the noise.
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Nexus Pay brings your everyday balance into one calm, secure place. Set up your
              wallet, see what matters, and leave the complexity to the ledger underneath.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Create your account
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-input bg-card px-6 text-sm font-semibold text-foreground shadow-xs transition-colors hover:bg-secondary"
              >
                Sign in
              </Link>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
              {["No stored balance", "Server-verified sessions", "Clear wallet states"].map(
                (item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[460px] animate-fade-up lg:mr-0">
            <div
              aria-hidden="true"
              className="absolute -inset-6 -z-10 rounded-[2rem] border border-border/70 bg-card/50"
            />
            <div className="rounded-[1.75rem] border border-border bg-card p-7 shadow-lift">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-white">
                    <WalletCards className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Nexus Wallet</p>
                    <p className="text-xs text-muted-foreground">Personal account</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Ready
                </span>
              </div>

              <div className="mt-9">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Available balance
                </p>
                <p className="mt-2 font-display text-[2.65rem] font-semibold tracking-[-0.04em] text-navy">
                  ₹0.00
                </p>
              </div>

              <div className="my-7 h-px bg-border" />

              <dl className="space-y-3.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Account status</dt>
                  <dd className="font-medium text-foreground">Protected</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Ledger</dt>
                  <dd className="font-medium text-foreground">Raftline</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Settlement currency</dt>
                  <dd className="font-medium text-foreground">INR</dd>
                </div>
              </dl>

              <div className="mt-7 flex items-start gap-3 rounded-xl bg-secondary/70 p-3.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Your balance is read directly from the authoritative ledger — never copied into
                  the app database.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border/70 bg-sand/40">
        <div className="container grid gap-4 py-8 sm:grid-cols-3">
          {[
            { icon: Layers3, label: "Replicated ledger", value: "Consensus-backed writes" },
            { icon: Fingerprint, label: "Identity", value: "Argon2id password hashing" },
            { icon: KeyRound, label: "Sessions", value: "HTTP-only and server-verified" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 px-1 py-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card">
                <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="py-20 lg:py-28">
        <div className="container">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Designed around clarity
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
              The essentials, done properly.
            </h2>
            <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
              No clutter, no invented numbers, no hidden state. Just a dependable view of your
              wallet and the systems protecting it.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              {
                icon: WalletCards,
                title: "One clear balance",
                body: "Your available balance is fetched from the ledger when you need it, with reservations accounted for.",
              },
              {
                icon: BadgeCheck,
                title: "Provisioning you can see",
                body: "Every wallet state is visible — from setup to active — with explicit recovery when something needs attention.",
              },
              {
                icon: ShieldCheck,
                title: "Security by default",
                body: "Hashed session tokens, same-site cookies, CSRF protection and rate limits are part of the foundation.",
              },
            ].map((feature) => (
              <article
                key={feature.title}
                className="rounded-2xl border border-border bg-card p-6 shadow-xs transition-shadow hover:shadow-soft"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent">
                  <feature.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold tracking-[-0.02em] text-navy">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-border/70 bg-card/60 py-20 lg:py-24">
        <div className="container grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              How it works
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
              From account to wallet in three considered steps.
            </h2>
            <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
              Nexus Pay keeps the path short and the state honest. You always know what has
              happened and what comes next.
            </p>
          </div>
          <ol className="space-y-3">
            {[
              {
                title: "Create your account",
                body: "Use your name, email and mobile number. Passwords are hashed with Argon2id.",
              },
              {
                title: "Complete your profile",
                body: "Choose a display name, username and preferred currency. Your wallet is queued for setup.",
              },
              {
                title: "Open your overview",
                body: "We provision your ledger account, verify it, and show the balance from the source of truth.",
              },
            ].map((step, index) => (
              <li
                key={step.title}
                className="flex gap-4 rounded-2xl border border-border bg-background p-4"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy text-xs font-semibold text-white">
                  0{index + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="security" className="py-20 lg:py-28">
        <div className="container grid gap-12 lg:grid-cols-2 lg:items-center">
          <div className="order-2 rounded-2xl border border-border bg-card p-7 shadow-xs lg:order-1">
            <div className="flex items-center gap-3 border-b border-border pb-5">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-navy text-white">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-display font-semibold text-navy">Security posture</p>
                <p className="text-xs text-muted-foreground">Foundation, not an afterthought</p>
              </div>
            </div>
            <ul className="mt-5 space-y-3">
              {[
                "Opaque session tokens stored only as server-side hashes",
                "HTTP-only, SameSite cookies with HTTPS enforcement in production",
                "Double-submit CSRF protection plus origin checks",
                "Single-use, expiring password reset links",
                "Input validation at every API boundary",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Reassurance by design
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
              Your balance has one source of truth.
            </h2>
            <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
              Nexus Pay never invents a balance or keeps a second copy in its own database. When
              the ledger is unavailable, we say so clearly instead of guessing.
            </p>
            <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
              Wallet setup is verified after creation. If an outcome is uncertain, the wallet moves
              into an explicit reconciliation state rather than retrying blindly.
            </p>
            <Link
              href="/register"
              className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-primary transition-colors hover:text-primary/80"
            >
              Open your Nexus wallet
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="pb-20 lg:pb-24">
        <div className="container">
          <div className="rounded-[1.75rem] border border-border bg-navy px-7 py-12 text-center shadow-lift sm:px-12">
            <h2 className="mx-auto max-w-xl font-display text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
              A calmer place for the money you use every day.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-white/65">
              Start with a secure account and a wallet that tells you exactly where it stands.
            </p>
            <Link
              href="/register"
              className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-navy transition-colors hover:bg-white/90"
            >
              Create your account
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
