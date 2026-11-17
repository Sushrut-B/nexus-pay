import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LogoutButton } from "@/components/layout/logout-button";
import { MerchantNav } from "@/components/merchant/merchant-nav";
import { initials } from "@/lib/format";
import { requireOnboardedUser } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Nexus Pay for Business" };

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireOnboardedUser("/merchant");
  return (
    <div className="flex min-h-screen flex-col bg-[#fafaf9]">
      <header className="border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-6">
            <Logo href="/home" />
            <nav className="hidden items-center gap-0.5 lg:flex"><MerchantNav /></nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 xl:flex">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-navy text-[10px] font-semibold text-white">
                {initials(auth.profile.displayName)}
              </span>
              <span className="text-xs font-medium">{auth.profile.displayName}</span>
            </span>
            <LogoutButton compact />
          </div>
        </div>
        <nav className="container flex gap-0.5 overflow-x-auto border-t border-border/60 py-2 lg:hidden">
          <MerchantNav mobile />
        </nav>
      </header>
      <main className="flex-1"><div className="container py-8">{children}</div></main>
      <Link href="/home" className="container mb-6 text-xs font-medium text-primary underline-offset-4 hover:underline">← Back to personal Nexus Pay</Link>
    </div>
  );
}

