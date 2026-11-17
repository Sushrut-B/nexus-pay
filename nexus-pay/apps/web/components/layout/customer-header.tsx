import Link from "next/link";
import { cn } from "@nexus/ui";
import { Logo } from "@/components/brand/logo";
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
        <div className="flex items-center gap-8">
          <Logo href="/home" />
          <nav className="hidden items-center gap-1 sm:flex">
            <NavLink href="/home">Overview</NavLink>
            <NavLink href="/profile">Profile</NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-3 rounded-xl border border-border bg-card px-3 py-1.5 md:flex">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-xs font-semibold text-white">
              {initials(displayName)}
            </span>
            <span className="max-w-[180px]">
              <span className="block truncate text-xs font-semibold leading-tight text-foreground">
                {displayName}
              </span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                {email}
              </span>
            </span>
          </div>
          <LogoutButton compact />
        </div>
      </div>
      <nav className="container flex gap-1 border-t border-border/60 py-2 sm:hidden">
        <NavLink href="/home">Overview</NavLink>
        <NavLink href="/profile">Profile</NavLink>
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
