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

test("customer rewards screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/rewards", "Your rewards"],
    ["/rewards/activity", "Rewards activity"],
    ["/rewards/offers", "Offers marketplace"],
    ["/rewards/catalogue", "Rewards catalogue"],
    ["/rewards/cashback", "Cashback history"],
    ["/rewards/membership", "Membership"],
    ["/rewards/referrals", "Referrals"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("merchant and Nexus Control rewards screens render", async ({ page }) => {
  await signIn(page);
  await page.goto("/merchant/rewards");
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();

  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);

  for (const [path, heading] of [
    ["/control/rewards", "Rewards operations"],
    ["/control/rewards/campaigns", "Campaign approval queue"],
    ["/control/rewards/cashback", "Cashback operations"],
    ["/control/rewards/investigations", "Reward investigations"],
    ["/control/rewards/reconciliation", "Reward reconciliation"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});
