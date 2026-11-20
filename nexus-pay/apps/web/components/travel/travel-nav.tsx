"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/travel", label: "Overview" },
  { href: "/travel/search", label: "Search" },
  { href: "/travel/bookings", label: "Bookings" },
  { href: "/travel/trips", label: "My trips" },
  { href: "/travel/documents", label: "Documents" },
];

export function TravelNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Travel sections">
      {LINKS.map((link) => {
        const active = link.href === "/travel" ? pathname === "/travel" : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
            className={cn("shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
