"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/wallet", label: "My Wallet" },
  { href: "/send", label: "Send Money" },
  { href: "/receive", label: "Receive Money" },
  { href: "/groups", label: "Split Expenses" },
  { href: "/requests", label: "Payment Requests" },
  { href: "/contacts", label: "Contacts" },
  { href: "/transactions", label: "Transactions" },
  { href: "/insights", label: "Insights" },
  { href: "/budgets", label: "Budgets" },
  { href: "/savings", label: "Savings Goals" },
  { href: "/scheduled", label: "Scheduled Payments" },
  { href: "/calendar", label: "Calendar" },
  { href: "/statements", label: "Statements" },
  { href: "/investments", label: "Investments" },
  { href: "/travel", label: "Travel" },
  { href: "/bill-payments", label: "Bills" },
  { href: "/security", label: "Security" },
  { href: "/insurance", label: "Insurance" },
  { href: "/credit", label: "Credit" },
  { href: "/accounts", label: "Accounts" },
  { href: "/finance", label: "Financial Intelligence" },
  { href: "/rewards", label: "Rewards" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/merchant", label: "For Business" },
  { href: "/profile", label: "Settings" },
];

export function CustomerNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((link) => {
        const active =
          pathname === link.href ||
          (link.href !== "/home" && pathname.startsWith(`${link.href}/`));
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
