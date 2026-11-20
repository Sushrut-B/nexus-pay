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

test("customer tax screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/tax", "Understand your tax position"],
    ["/tax/income", "Income summary & classification"],
    ["/tax/compare", "Old vs new tax regime"],
    ["/tax/capital-gains", "Capital gains centre"],
    ["/tax/deductions", "Deductions, TDS & TCS"],
    ["/tax/documents", "Tax documents & reconciliation"],
    ["/tax/planning", "Scenarios & tax calendar"],
    ["/tax/filing", "Prepare & understand"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("customer can compare regimes and ask the tax assistant", async ({ page }) => {
  await signIn(page);
  await page.goto("/tax/compare");
  await page.getByRole("button", { name: "Compare regimes" }).click();
  await expect(page.getByText(/Estimated difference/).first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/tax/filing");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/assessment year/)).toBeVisible({ timeout: 30_000 });
});

test("Nexus Control tax operations screens render", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  for (const [path, heading] of [
    ["/control/tax", "Tax operations"],
    ["/control/tax/jobs", "Processing jobs"],
    ["/control/tax/rules", "Rule versions"],
    ["/control/tax/reconciliation", "Reconciliation exceptions"],
    ["/control/tax/audit", "Tax audit history"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});
