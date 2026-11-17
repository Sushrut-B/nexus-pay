import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create your account",
};

export default async function RegisterPage() {
  const auth = await getAuthenticatedUser();
  if (auth) {
    redirect(auth.user.onboardingCompletedAt ? "/home" : "/onboarding");
  }

  return (
    <AuthCard
      title="Create your Nexus Pay account"
      description="A secure account, a clear wallet, and no unnecessary steps."
      footer={
        <p>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
