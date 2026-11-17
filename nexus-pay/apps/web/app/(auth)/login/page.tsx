import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

function safeNextPath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/login") || value.startsWith("/api/")) return null;
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; next?: string }>;
}) {
  const { reset, next } = await searchParams;
  const nextPath = safeNextPath(next);

  const auth = await getAuthenticatedUser();
  if (auth) {
    redirect(auth.user.onboardingCompletedAt ? nextPath ?? "/home" : "/onboarding");
  }

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to see your wallet, balance and account details."
      notice={
        reset === "success"
          ? {
              variant: "success",
              message: "Your password has been reset. Sign in with your new password.",
            }
          : undefined
      }
      footer={
        <p>
          New to Nexus Pay?{" "}
          <Link
            href="/register"
            className="font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <LoginForm nextPath={nextPath} />
    </AuthCard>
  );
}
