"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/wallet", label: "Wallet" },
  { href: "/send", label: "Send" },
  { href: "/wallet/add-money", label: "Add money", match: "/wallet/add-money" },
  { href: "/receive", label: "Receive" },
  { href: "/transactions", label: "Transactions" },
  { href: "/profile", label: "Profile" },
];

export function CustomerNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((link) => {
        const active =
          pathname === link.href ||
          (link.match
            ? pathname.startsWith(link.match)
            : link.href !== "/home" && pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              mobile ? "text-[13px]" : "",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
