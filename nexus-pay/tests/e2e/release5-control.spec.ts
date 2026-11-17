import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@nexuspay.local";
const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "Control!2026Admin";

async function signIn(page: Page) {
  await page.goto("/control");
  await expect(page).toHaveURL(/\/control\/login/);
  await page.getByLabel("Email or username").fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Sign in to Nexus Control" }).click();
  await expect(page).toHaveURL(/\/control$/);
}

test("Nexus Control renders live operations screens after administrator sign-in", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("heading", { name: "Cluster overview" })).toBeVisible();
  await expect(page.getByText("Cluster health")).toBeVisible();
  await expect(page.getByText("Current leader")).toBeVisible();
  await expect(page.getByText(/node-[1-5]/).first()).toBeVisible();

  for (const [path, heading] of [
    ["/control/cluster", "Cluster status"],
    ["/control/nodes", "Nodes"],
    ["/control/leader-elections", "Leader elections"],
    ["/control/chaos", "Chaos engineering"],
    ["/control/payments", "Payments"],
    ["/control/reconciliation", "Reconciliation"],
    ["/control/metrics", "Metrics"],
    ["/control/alerts", "Alerts"],
    ["/control/audit", "Administrative audit"],
    ["/control/diagnostics", "Diagnostics"],
    ["/control/admin", "Administration"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});
