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

test("customer global finance screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/global-finance", "Your money across currencies"],
    ["/global-finance/accounts", "Currency accounts"],
    ["/global-finance/converter", "Currency converter"],
    ["/global-finance/rates", "Exchange rates"],
    ["/global-finance/rates/history", "Historical exchange rates"],
    ["/global-finance/watchlists", "Watchlists & rate alerts"],
    ["/global-finance/payments", "International payments"],
    ["/global-finance/beneficiaries", "International beneficiaries"],
    ["/global-finance/transfers", "International transfers"],
    ["/global-finance/expenses", "International expenses"],
    ["/global-finance/travel", "Travel currency"],
    ["/global-finance/assets", "Foreign assets & liabilities"],
    ["/global-finance/insights", "Global financial insights"],
    ["/global-finance/settings", "Global Finance settings"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("global finance displays honest unavailable and indicative states", async ({ page }) => {
  await signIn(page);
  await page.goto("/global-finance");
  await expect(page.getByText(/only transactable Nexus Pay wallet currency/i).first()).toBeVisible();
  await page.goto("/global-finance/payments");
  await expect(page.getByText(/International transfers are UNAVAILABLE/i).first()).toBeVisible();
  await page.goto("/global-finance/settings");
  await expect(page.getByText(/does NOT change your wallet currency/i).first()).toBeVisible();
});

test("Nexus Control global finance operations screen renders", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await page.goto("/control/global");
  await expect(page.getByRole("heading", { name: "Global Finance operations", exact: false }).first()).toBeVisible();
});
