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

test("customer investment screens render", async ({ page }) => {
  await signIn(page);
  for (const [path, heading] of [
    ["/investments", "Your wealth at a glance"],
    ["/investments/portfolio", "Holdings and performance"],
    ["/investments/connections", "Investment account connections"],
    ["/investments/explore", "Funds and market instruments"],
    ["/investments/watchlist", "Watchlists & price alerts"],
    ["/investments/sips", "SIP tracking & planner"],
    ["/investments/wealth", "Net worth overview"],
    ["/investments/goals", "Investment goals"],
    ["/investments/documents", "Investment documents"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("customer can calculate a hypothetical SIP and create a goal", async ({ page }) => {
  await signIn(page);
  await page.goto("/investments/sips");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByText(/Estimated maturity/)).toBeVisible();
  await page.goto("/investments/goals");
  await page.getByLabel("Goal name").fill("Test goal");
  await page.getByLabel("Target (₹)").fill("100000");
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByText("Test goal").first()).toBeVisible();
});

test("Nexus Control investment operations screens render", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  for (const [path, heading] of [
    ["/control/investments", "Investment operations"],
    ["/control/investments/jobs", "Synchronization jobs"],
    ["/control/investments/history", "Synchronization history"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});
