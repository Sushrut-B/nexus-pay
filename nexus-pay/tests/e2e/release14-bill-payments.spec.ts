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

test("customer bill payment screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/bill-payments", "Your bills & recharges"],
    ["/bill-payments/marketplace", "Browse billers"],
    ["/bill-payments/accounts", "Saved bill accounts"],
    ["/bill-payments/fetch", "Fetch and pay a bill"],
    ["/bill-payments/calendar", "Bill calendar & recurring bills"],
    ["/bill-payments/recharges", "Prepaid recharges"],
    ["/bill-payments/households", "Household bills"],
    ["/bill-payments/history", "Bill payment history & receipts"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("customer can save a bill account", async ({ page }) => {
  await signIn(page);
  await page.goto("/bill-payments/accounts");
  const biller = page.locator("#biller option").nth(1);
  const value = await biller.getAttribute("value");
  test.skip(!value, "No sandbox biller available");
  await page.locator("#biller").selectOption(value!);
  await page.getByLabel("Nickname").fill("Home electricity");
  await page.getByLabel("Account identifier").fill("TEST-CONSUMER-1234");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByText("Bill account saved (identifiers masked)")).toBeVisible();
});

test("Nexus Control bill payments screens render", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  for (const [path, heading] of [
    ["/control/bill-payments", "Bill payments operations"],
    ["/control/bill-payments/transactions", "Transactions"],
    ["/control/bill-payments/reconciliation", "Reconciliation queue"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});
