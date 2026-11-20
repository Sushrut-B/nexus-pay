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
    ["/security", "Your security overview"],
    ["/security/activity", "Recent security activity"],
    ["/security/sessions", "Active sessions"],
    ["/security/devices", "Trusted devices"],
    ["/security/settings", "Security settings"],
    ["/security/warnings", "Security warnings"],
    ["/security/reports", "Report suspicious activity"],
    ["/security/safety", "Recognise and avoid scams"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});

test("customer can submit a fraud report", async ({ page }) => {
  await signIn(page);
  await page.goto("/security/reports");
  await page.getByLabel("What happened?").fill("I do not recognise a recent sign-in attempt on my account.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Report recorded for investigation")).toBeVisible();
});

test("Nexus Control fraud intelligence screens render", async ({ page }) => {
  await signIn(page);
  await page.goto("/control/login");
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  for (const [path, heading] of [
    ["/control/fraud", "Fraud intelligence"],
    ["/control/fraud/alerts", "Risk alerts"],
    ["/control/fraud/cases", "Investigation queue"],
    ["/control/fraud/rules", "Fraud rules"],
    ["/control/fraud/models", "Model monitoring"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  }
});
