"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/security", label: "Overview" },
  { href: "/security/activity", label: "Activity" },
  { href: "/security/sessions", label: "Sessions" },
  { href: "/security/devices", label: "Devices" },
  { href: "/security/settings", label: "Settings" },
  { href: "/security/mfa", label: "Authentication" },
  { href: "/security/recovery", label: "Account recovery" },
  { href: "/security/privacy", label: "Privacy & consent" },
  { href: "/security/my-data", label: "My data" },
  { href: "/security/warnings", label: "Warnings" },
  { href: "/security/reports", label: "Report a problem" },
  { href: "/security/safety", label: "Safety centre" },
];

export function SecurityNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Security sections">
      {LINKS.map((link) => {
        const active = link.href === "/security" ? pathname === "/security" : pathname.startsWith(link.href);
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
