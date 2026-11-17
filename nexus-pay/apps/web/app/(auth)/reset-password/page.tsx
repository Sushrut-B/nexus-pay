import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@nexus/ui";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthCard
      title="Choose a new password"
      description="Your reset link can be used once. Choose a strong password you have not used before."
      footer={
        <p>
          Need a fresh link?{" "}
          <Link
            href="/forgot-password"
            className="font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Request another
          </Link>
        </p>
      }
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Reset link missing</AlertTitle>
          <AlertDescription>
            <p>
              This page needs a valid reset token. Request a new password reset link to continue.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </AuthCard>
  );
}
