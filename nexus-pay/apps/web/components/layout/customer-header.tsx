import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { CustomerNav } from "@/components/layout/customer-nav";
import { NotificationCenter } from "@/components/layout/notification-center";
import { LogoutButton } from "@/components/layout/logout-button";
import { initials } from "@/lib/format";

export function CustomerHeader({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  return (
    <header className="border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="container flex h-[72px] items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-6">
          <Logo href="/home" />
          <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
            <CustomerNav />
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <NotificationCenter />
          <Link
            href="/profile"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
            title="Account settings"
            aria-label="Account settings"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/profile"
            className="hidden items-center gap-3 rounded-xl border border-border bg-card px-3 py-1.5 transition-colors hover:bg-secondary/60 xl:flex"
            aria-label="Open your profile"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-xs font-semibold text-white">
              {initials(displayName)}
            </span>
            <span className="max-w-[160px]">
              <span className="block truncate text-xs font-semibold leading-tight text-foreground">
                {displayName}
              </span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                {email}
              </span>
            </span>
          </Link>
          <LogoutButton compact />
        </div>
      </div>
      <nav className="container flex gap-0.5 overflow-x-auto border-t border-border/60 py-2 lg:hidden">
        <CustomerNav mobile />
      </nav>
    </header>
  );
}
