import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-sand/50">
      <div className="container flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Logo href={null} />
          <p className="max-w-sm text-sm text-muted-foreground">
            A clearer, safer home for your everyday money.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/login" className="transition-colors hover:text-foreground">
            Sign in
          </Link>
          <Link href="/register" className="transition-colors hover:text-foreground">
            Create account
          </Link>
          <Link href="/forgot-password" className="transition-colors hover:text-foreground">
            Account recovery
          </Link>
        </div>
      </div>
      <div className="border-t border-border/70">
        <div className="container py-5 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Nexus Pay. Built for a calmer financial life.
        </div>
      </div>
    </footer>
  );
}
