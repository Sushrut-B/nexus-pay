import { redirect } from "next/navigation";
import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth/session";

export async function requireUser(returnTo = "/home"): Promise<AuthenticatedUser> {
  const auth = await getAuthenticatedUser();
  if (!auth) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  return auth;
}

export async function requireOnboardedUser(returnTo = "/home"): Promise<AuthenticatedUser> {
  const auth = await requireUser(returnTo);
  if (!auth.user.onboardingCompletedAt) {
    redirect("/onboarding");
  }
  return auth;
}

export async function requireIncompleteOnboarding(): Promise<AuthenticatedUser> {
  const auth = await requireUser("/onboarding");
  if (auth.user.onboardingCompletedAt) {
    redirect("/home");
  }
  return auth;
}
