"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/rewards", label: "Overview" },
  { href: "/rewards/activity", label: "Activity" },
  { href: "/rewards/offers", label: "Offers" },
  { href: "/rewards/catalogue", label: "Redeem" },
  { href: "/rewards/cashback", label: "Cashback" },
  { href: "/rewards/membership", label: "Membership" },
  { href: "/rewards/referrals", label: "Referrals" },
];

export function RewardsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Rewards sections">
      {LINKS.map((link) => {
        const active = link.href === "/rewards" ? pathname === "/rewards" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
