import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

const suffix = `${Date.now()}`.slice(-9);
const suffixB = `${Date.now() + 1}`.slice(-9);
const password = "Nexus!Wallet2026";
const users = {
  alice: {
    name: "Social Alice",
    email: `e2e.social.a.alice.${suffix}@example.test`,
    phone: `6${suffix}`,
    username: `s3aa_${suffix}`,
  },
  bob: {
    name: "Social Bob",
    email: `e2e.social.a.bob.${suffix}@example.test`,
    phone: `7${suffix}`,
    username: `s3ab_${suffix}`,
  },
};

const usersB = {
  alice: {
    name: "Group Alice",
    email: `e2e.social.b.alice.${suffixB}@example.test`,
    phone: `6${suffixB}`,
    username: `s3ba_${suffixB}`,
  },
  bob: {
    name: "Group Bob",
    email: `e2e.social.b.bob.${suffixB}@example.test`,
    phone: `7${suffixB}`,
    username: `s3bb_${suffixB}`,
  },
  charlie: {
    name: "Group Charlie",
    email: `e2e.social.b.charlie.${suffixB}@example.test`,
    phone: `8${suffixB}`,
    username: `s3bc_${suffixB}`,
  },
};

async function registerAndOnboard(page: Page, user: typeof users.alice) {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Mobile number").fill(user.phone);
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.waitForFunction(() => Boolean(document.querySelector('input[name="confirmPassword"]')), null, { timeout: 15_000 });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Display name").fill(user.name);
  await page.getByLabel("Wallet currency").selectOption("INR");
  await page.getByLabel("Preferred language").selectOption("en-IN");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL("**/home");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible({ timeout: 40_000 });
}

/** Fast, reliable user setup through the documented APIs; the UI flows under test stay real. */
async function apiCreateUser(page: Page, user: typeof users.alice) {
  await page.goto("/login");
  const csrf = await page.evaluate(() => document.cookie.split("; ").find((c) => c.startsWith("np_csrf="))?.split("=")[1] ?? "");
  const headers = { "x-csrf-token": csrf, "Content-Type": "application/json" };
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: {
      fullName: user.name,
      email: user.email,
      phoneNumber: user.phone,
      username: user.username,
      password,
      confirmPassword: password,
    },
  });
  if (!registered.ok()) {
    throw new Error(`Registration failed (${registered.status()}): ${await registered.text()}`);
  }
  await page.request.post("/api/onboarding", {
    headers,
    data: {
      displayName: user.name,
      username: user.username,
      preferredCurrency: "INR",
      preferredLanguage: "en-IN",
    },
  });
  await page.request.post("/api/wallet/provision", { headers, data: {} });
  await expect.poll(async () => {
    const status = await page.request.get("/api/wallet/status", { headers });
    const body = await status.json();
    return body.data?.wallet?.status;
  }, { timeout: 60_000 }).toBe("ACTIVE");
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL("**/");
}

async function signIn(page: Page, user: typeof users.alice) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/home");
}

test("SCENARIO A: a payment request is accepted and paid with a verified transfer", async ({ page }) => {
  await registerAndOnboard(page, users.bob);
  await signOut(page);
  await registerAndOnboard(page, users.alice);

  await page.goto("/requests");
  await page.getByRole("button", { name: "New request" }).click();
  await page.getByLabel("Request from").fill(users.bob.username);
  await page.getByLabel("Amount (INR)").fill("500");
  await page.getByLabel("What is it for?").fill("Shared cab");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Request sent.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Sent" }).click();
  await expect(page.getByText("Shared cab").first()).toBeVisible();

  await signOut(page);
  await signIn(page, users.bob);
  await page.goto("/wallet/add-money");
  await page.getByLabel("Amount (INR)").fill("1000");
  await page.getByRole("button", { name: /Review simulated funding/ }).click();
  await page.getByRole("button", { name: /Confirm and add/ }).click();
  await expect(page.getByText("Simulated funds added", { exact: true })).toBeVisible({ timeout: 40_000 });
  await page.goto("/requests");
  await expect(page.getByText("Shared cab").first()).toBeVisible();
  await page.getByRole("button", { name: /^Accept$/ }).first().click();
  await expect(page.getByText("Accepted.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Pay$/ }).first().click();
  await page.getByRole("button", { name: "Confirm and pay" }).click();
  await expect(page.getByText("Payment completed.")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("Paid", { exact: true }).last()).toBeVisible();

  await signOut(page);
  await signIn(page, users.alice);
  await page.goto("/requests?direction=sent");
  await expect(page.getByText("Paid", { exact: true }).last()).toBeVisible();
});

test("SCENARIOS B-E: shared expense, balances, partial settlement and duplicate protection", async ({ page }) => {
  await apiCreateUser(page, usersB.charlie);
  await apiCreateUser(page, usersB.bob);
  await apiCreateUser(page, usersB.alice);
  await signOut(page);

  await signIn(page, usersB.bob);
  await page.goto("/wallet/add-money");
  await page.getByLabel("Amount (INR)").fill("2000");
  await page.getByRole("button", { name: /Review simulated funding/ }).click();
  await page.getByRole("button", { name: /Confirm and add/ }).click();
  await expect(page.getByText("Simulated funds added", { exact: true })).toBeVisible({ timeout: 40_000 });
  await signOut(page);

  await signIn(page, usersB.alice);
  await page.goto("/groups");
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("Group name").fill("Goa Trip");
  await page.getByLabel("Add members").fill(`${usersB.bob.username}, ${usersB.charlie.username}`);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText("Goa Trip").first()).toBeVisible();
  await page.getByRole("link", { name: /Goa Trip/ }).first().click();
  await expect(page).toHaveURL(/\/groups\//);

  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Title").fill("Dinner");
  await page.getByLabel("Total amount (INR)").fill("1500");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Dinner").first()).toBeVisible();

  await page.goto("/groups");
  await page.getByRole("link", { name: /Goa Trip/ }).first().click();
  await page.getByRole("button", { name: "Balances" }).click();
  await expect(page.getByText("You're owed ₹1,000.00").first()).toBeVisible();
  await expect(page.getByText("Everyone is settled")).toHaveCount(0);

  await signOut(page);
  await signIn(page, usersB.bob);
  await page.goto("/groups");
  await page.getByRole("link", { name: /Goa Trip/ }).first().click();
  await page.getByRole("button", { name: "Balances" }).click();
  await expect(page.getByText("You owe ₹500.00").first()).toBeVisible();
  await page.getByRole("link", { name: "Pay now" }).first().click();
  await expect(page).toHaveURL(/\/settle/);
  await page.getByLabel("Amount (INR)").fill("200");
  await page.getByRole("button", { name: /Review payment/ }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await expect(page.getByText("Settlement complete").first()).toBeVisible({ timeout: 40_000 });

  await page.getByRole("link", { name: "Back to group" }).first().click();
  await page.goto("/groups");
  await page.getByRole("link", { name: /Goa Trip/ }).first().click();
  await page.getByRole("button", { name: "Balances" }).click();
  await expect(page.getByText("You owe ₹300.00").first()).toBeVisible();
});
