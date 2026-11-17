import { redirect } from "next/navigation";
import { CustomerHeader } from "@/components/layout/customer-header";
import { getAuthenticatedUser } from "@/lib/auth/session";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthenticatedUser();
  if (!auth) {
    redirect("/login?next=/home");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <CustomerHeader
        displayName={auth.profile.displayName}
        email={auth.user.email}
      />
      <main className="flex-1">
        <div className="container py-8 sm:py-10">{children}</div>
      </main>
      <footer className="border-t border-border/70">
        <div className="container flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Nexus Pay</p>
          <p>Balances are provided by the Raftline ledger.</p>
        </div>
      </footer>
    </div>
  );
}
