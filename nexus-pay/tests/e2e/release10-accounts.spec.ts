import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill("demo_alice");
  await page.getByLabel("Password", { exact: true }).fill("Sandbox!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test("customer account screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/accounts", "Your accounts"],
    ["/accounts/connect", "Add a financial account"],
    ["/accounts/transactions", "Transactions"],
    ["/accounts/analytics", "Account analytics"],
    ["/accounts/consents", "Data-sharing consents"],
    ["/accounts/privacy", "Your financial data"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("Nexus Control external account operations render", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await page.goto("/control/accounts");
  await expect(page.getByRole("heading", { name: "External account operations" })).toBeVisible();
});
