import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const suffix = `${Date.now()}`.slice(-9);
const password = "Nexus!Wallet2026";
const bob = {
  name: "Release Two Bob",
  email: `e2e.bob.${suffix}@example.test`,
  phone: `8${suffix}`,
  username: `r2b_${suffix}`,
};
const alice = {
  name: "Release Two Alice",
  email: `e2e.alice.${suffix}@example.test`,
  phone: `7${suffix}`,
  username: `r2a_${suffix}`,
};

async function registerAndOnboard(page: Page, customer: typeof alice) {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(customer.name);
  await page.getByLabel("Email address").fill(customer.email);
  await page.getByLabel("Mobile number").fill(customer.phone);
  await page.getByLabel("Username").fill(customer.username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForURL("**/onboarding");

  await page.getByLabel("Display name").fill(customer.name);
  await page.getByLabel("Wallet currency").selectOption("INR");
  await page.getByLabel("Preferred language").selectOption("en-IN");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL("**/home");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible({ timeout: 40_000 });
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL("**/");
}

async function signIn(page: Page, customer: typeof alice) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(customer.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/home");
}

test("funds a sandbox wallet, pays a recipient and exposes a verified receipt", async ({ page }) => {
  // The recipient must exist and be active before the sender can resolve it.
  await registerAndOnboard(page, bob);
  await signOut(page);

  await registerAndOnboard(page, alice);

  await page.goto("/wallet/add-money");
  await page.getByLabel("Amount (INR)").fill("5000");
  await page.getByRole("button", { name: /Review simulated funding/ }).click();
  await page.getByRole("button", { name: /Confirm and add/ }).click();
  await expect(page.getByText("Simulated funds added", { exact: true })).toBeVisible({
    timeout: 40_000,
  });
  await expect(page.getByText(/SIMULATED SANDBOX FUNDING/).first()).toBeVisible();

  await page.goto("/receive");
  await expect(page.getByText(`@${alice.username}`)).toBeVisible();
  await expect(page.getByAltText(`Nexus Pay QR code for @${alice.username}`)).toBeVisible();

  await page.goto("/send");
  await page
    .getByLabel("Recipient username, email address or mobile number")
    .fill(bob.username);
  await page.getByRole("button", { name: "Find recipient" }).click();
  await expect(page.getByText(`@${bob.username}`)).toBeVisible();
  await page.getByLabel("Amount (INR)").fill("500");
  await page.getByRole("button", { name: /Review payment/ }).click();
  await page.getByRole("button", { name: /Confirm and send/ }).click();
  await expect(page.getByText("Payment successful", { exact: true })).toBeVisible({
    timeout: 40_000,
  });

  await page.goto("/transactions");
  await expect(page.getByText(bob.name, { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: /Open transaction/ }).first().click();
  await expect(page.getByText("Reference", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Download PDF receipt/ })).toBeVisible();

  await signOut(page);
  await signIn(page, bob);
  await page.goto("/transactions?filter=RECEIVED");
  await expect(page.getByText(alice.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/₹500\.00/).first()).toBeVisible();
});
