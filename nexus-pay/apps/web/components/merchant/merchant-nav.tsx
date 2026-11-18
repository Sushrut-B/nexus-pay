"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/merchant", label: "Overview" },
  { href: "/merchant/orders", label: "Orders" },
  { href: "/merchant/payment-links", label: "Payment Links" },
  { href: "/merchant/qr", label: "QR Payments" },
  { href: "/merchant/plans", label: "Plans" },
  { href: "/merchant/subscriptions", label: "Subscriptions" },
  { href: "/merchant/invoices", label: "Invoices" },
  { href: "/merchant/billing", label: "Billing" },
  { href: "/merchant/customers", label: "Customers" },
  { href: "/merchant/refunds", label: "Refunds" },
  { href: "/merchant/analytics", label: "Analytics" },
  { href: "/merchant/developers", label: "Developers" },
  { href: "/merchant/settings", label: "Settings" },
];

export function MerchantNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((link) => {
        const active = link.href === "/merchant" ? pathname === "/merchant" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              mobile ? "text-[13px]" : "",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
