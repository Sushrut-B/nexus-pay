import type { Metadata } from "next";
import { Suspense } from "react";
import { ControlLoginForm } from "./control-login-form";

export const metadata: Metadata = { title: "Administrator sign in" };

export default function ControlLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900" />}>
      <ControlLoginForm />
    </Suspense>
  );
}
