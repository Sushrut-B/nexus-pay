import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill("demo_alice");
  await page.getByLabel("Password", { exact: true }).fill("Sandbox!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Anchored regex: the glob "**/home" also matches "/login?next=/home".
  await expect(page).toHaveURL(/\/home$/);
}

test("subscription management and customer portal pages render", async ({ page }) => {
  await signIn(page);

  for (const [path, heading] of [
    ["/merchant/plans", "Subscription plans"],
    ["/merchant/subscriptions", "Subscriptions"],
    ["/merchant/invoices", "Invoices"],
    ["/merchant/billing", "Billing & recovery"],
    ["/subscriptions", "My subscriptions"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }

  await page.goto("/merchant/plans");
  await expect(page.getByRole("button", { name: "New plan" })).toBeVisible();
});

test("Nexus Control billing operations render", async ({ page }) => {
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);

  await page.goto("/control/subscriptions");
  await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
  await page.goto("/control/billing");
  await expect(page.getByRole("heading", { name: "Billing operations" })).toBeVisible();
});
