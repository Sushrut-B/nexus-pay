import Link from "next/link";
import { cn } from "@nexus/ui";

export function Logo({
  href = "/",
  inverse = false,
  className,
}: {
  href?: string | null;
  inverse?: boolean;
  className?: string;
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="36" height="36" rx="11" fill={inverse ? "#FFFFFF" : "#0F172A"} />
        <path
          d="M10 25V11L26 25V11"
          stroke={inverse ? "#0F172A" : "#FFFFFF"}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="26" cy="11" r="2.4" fill="#2563EB" />
      </svg>
      <span
        className={cn(
          "font-display text-[17px] font-semibold tracking-[-0.02em]",
          inverse ? "text-white" : "text-navy",
        )}
      >
        Nexus Pay
      </span>
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} className="rounded-lg focus-ring" aria-label="Nexus Pay home">
      {content}
    </Link>
  );
}
