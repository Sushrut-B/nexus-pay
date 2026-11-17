"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function logout() {
    startTransition(async () => {
      try {
        await apiFetch<{ redirectTo: string }>("/api/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof ApiClientError ? error.message : "Could not sign you out. Try again.",
        );
      }
    });
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span className={compact ? "sr-only sm:not-sr-only" : ""}>
        {pending ? "Signing out…" : "Sign out"}
      </span>
    </button>
  );
}
