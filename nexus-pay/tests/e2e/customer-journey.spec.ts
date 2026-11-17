import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const suffix = `${Date.now()}`.slice(-9);
const email = `e2e.${suffix}@example.test`;
const phone = `9${suffix}`;
const username = `e2e_${suffix}`;
const password = "Nexus!Wallet2026";
const newPassword = "Nexus!Reset2026";

test("protected customer pages redirect to sign in", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("customer can register, verify a wallet, update profile, sign in and reset password", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your Nexus Pay account" })).toBeVisible();

  await page.getByLabel("Full name").fill("Nexus Tester");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();

  await page.waitForURL("**/onboarding");
  await expect(page.getByRole("heading", { name: "Make Nexus Pay yours" })).toBeVisible();

  await page.getByLabel("Display name").fill("Nexus Updated");
  await page.getByLabel("Wallet currency").selectOption("INR");
  await page.getByLabel("Preferred language").selectOption("en-IN");
  await page.getByRole("button", { name: "Finish setup" }).click();

  await page.waitForURL("**/home");
  await expect(page.getByRole("heading", { name: /Good to see you/ })).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("₹0.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Verification needed")).toHaveCount(0);
  await expect(page.getByText("Needs attention")).toHaveCount(0);

  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await page.waitForURL("**/profile");
  await expect(page.getByRole("heading", { name: "Profile & security" })).toBeVisible();
  await page.getByLabel("Display name").fill("Nexus Profile");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated.")).toBeVisible();
  await expect(page.getByText("Nexus Profile")).toBeVisible();

  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL("**/");

  await page.goto("/login");
  await page.getByLabel("Email or username").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/home");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("₹0.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL("**/");

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.getByRole("link", { name: "Open password reset link" }).click();
  await page.waitForURL("**/reset-password?token=*");

  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.waitForURL("**/login?reset=success");
  await expect(page.getByText("Your password has been reset.")).toBeVisible();

  await page.getByLabel("Email or username").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/home");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
});
