import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { requireActiveMerchant, requireMerchantForUser } from "@/lib/merchant/merchant-service";

export async function requireMerchantUser() {
  const auth = await getAuthenticatedUser();
  if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
  return auth.user;
}

export async function requireUserAndMerchant() {
  const user = await requireMerchantUser();
  const merchant = await requireMerchantForUser(user.id);
  return { user, merchant };
}

export async function requireUserAndActiveMerchant() {
  const user = await requireMerchantUser();
  const merchant = await requireActiveMerchant(user.id);
  return { user, merchant };
}
