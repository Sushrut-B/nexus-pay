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

test("customer insurance screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/insurance", "Your insurance hub"],
    ["/insurance/marketplace", "Insurance products"],
    ["/insurance/compare", "Compare products"],
    ["/insurance/quotes", "Insurance quotes"],
    ["/insurance/applications", "Insurance applications"],
    ["/insurance/policies", "My policies"],
    ["/insurance/claims", "Claims"],
    ["/insurance/documents", "Insurance document centre"],
    ["/insurance/privacy", "Consent & data sharing"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("Nexus Control insurance operations render", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await page.goto("/control/insurance");
  await expect(page.getByRole("heading", { name: "Insurance operations" })).toBeVisible();
});
