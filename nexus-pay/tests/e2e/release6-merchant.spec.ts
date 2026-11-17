import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill("demo_alice");
  await page.getByLabel("Password", { exact: true }).fill("Sandbox!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // A regex anchored to the end: the glob "**/home" also matches
  // "/login?next=/home" ("/home" appears inside the query string), which
  // resolves before sign-in has actually completed.
  await expect(page).toHaveURL(/\/home$/);
}

test("merchant pages and Nexus Control merchant operations render", async ({ page }) => {
  await signIn(page);

  await page.goto("/merchant");
  await expect(page.getByRole("link", { name: "Payment Links" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Business dashboard" })).toBeVisible();

  await page.goto("/merchant/onboarding");
  await expect(page.getByRole("heading", { name: /Start accepting payments/ })).toBeVisible();

  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);

  await page.goto("/control/merchants");
  await expect(page.getByRole("heading", { name: "Merchants" })).toBeVisible();
  await page.goto("/control/merchant-refunds");
  await expect(page.getByRole("heading", { name: "Merchant refunds" })).toBeVisible();
});
