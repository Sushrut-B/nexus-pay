import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter the email address on your account. If it matches, we will send a secure reset link."
      footer={
        <p>
          Remembered it?{" "}
          <Link
            href="/login"
            className="font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
