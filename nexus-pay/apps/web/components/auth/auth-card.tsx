import Link from "next/link";
import { Alert } from "@nexus/ui";

export function AuthCard({
  title,
  description,
  children,
  footer,
  notice,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  notice?: { variant: "success" | "info"; message: string };
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
      <div>
        <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.035em] text-navy">
          {title}
        </h1>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      {notice ? (
        <Alert variant={notice.variant} className="mt-6">
          <p>{notice.message}</p>
        </Alert>
      ) : null}

      <div className="mt-7">{children}</div>

      {footer ? (
        <div className="mt-7 border-t border-border pt-5 text-sm text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

export function AuthTextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-semibold text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
    >
      {children}
    </Link>
  );
}
