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

test("customer support screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/support", "How can we help?"],
    ["/support/cases", "My cases"],
    ["/support/new", "Report an issue"],
    ["/support/new/success", "Case submitted"],
    ["/support/help", "Help Centre"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("support home states that cases do not change financial status", async ({ page }) => {
  await signIn(page);
  await page.goto("/support");
  await expect(page.getByText(/never changes a payment or provider status/i).first()).toBeVisible();
  await page.goto("/support/new");
  await expect(page.getByText(/Never include passwords, PINs, OTPs/i).first()).toBeVisible();
});

test("Nexus Control support operations screens render", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  for (const [path, heading] of [
    ["/control/support", "Support inbox"],
    ["/control/support/escalations", "Escalation view"],
    ["/control/support/analytics", "Support analytics"],
    ["/control/support/articles", "Help article administration"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});
