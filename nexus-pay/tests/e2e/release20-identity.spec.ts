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

test("customer security screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/security", "Security"],
    ["/security/activity", "Security activity"],
    ["/security/sessions", "Active sessions"],
    ["/security/devices", "Devices"],
    ["/security/mfa", "Authentication methods"],
    ["/security/recovery", "Account recovery"],
    ["/security/privacy", "Privacy & consent"],
    ["/security/my-data", "My data"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("security screens state honest limitations", async ({ page }) => {
  await signIn(page);
  await page.goto("/security/mfa");
  await expect(page.getByText(/Passkeys\/WebAuthn are unavailable/i).first()).toBeVisible();
  await page.goto("/security/recovery");
  await expect(page.getByText(/No identity verification is performed/i).first()).toBeVisible();
  await page.goto("/security/my-data");
  await expect(page.getByText(/no financial or ledger record is erased/i).first()).toBeVisible();
});

test("Nexus Control security operations screen renders", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await page.goto("/control/security");
  await expect(page.getByRole("heading", { name: "Security operations", exact: false }).first()).toBeVisible();
});
