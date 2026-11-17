import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { CategoriesView } from "./categories-view";

export const metadata: Metadata = {
  title: "Transaction categories",
};

export default async function CategoriesPage() {
  await requireOnboardedUser("/transactions/categories");
  return <CategoriesView />;
}

