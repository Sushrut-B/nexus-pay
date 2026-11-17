import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill("demo_alice");
  await page.getByLabel("Password", { exact: true }).fill("Sandbox!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/home");
}

test("personal finance screens render with real data and support planning workflows", async ({ page }) => {
  await signIn(page);

  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: /Your money/ })).toBeVisible();
  await expect(page.getByText("Money received")).toBeVisible();
  await expect(page.getByText("Eligible spending", { exact: true })).toBeVisible();

  await page.goto("/insights/spending");
  await expect(page.getByRole("heading", { name: "Where your money went." })).toBeVisible();
  await expect(page.getByText("Category breakdown")).toBeVisible();

  await page.goto("/transactions/categories");
  await expect(page.getByRole("heading", { name: "Make sense of your transactions." })).toBeVisible();
  await page.getByRole("button", { name: "My rules" }).click();
  await expect(page.getByText("Create a rule")).toBeVisible();

  await page.goto("/budgets");
  await expect(page.getByRole("heading", { name: "Spend with intention." })).toBeVisible();
  await page.getByRole("button", { name: "New budget" }).click();
  await page.getByLabel("Budget name").fill("E2E food budget");
  await page.getByLabel("Amount (INR)").fill("6000");
  const categorySelect = page.locator("#budget-category");
  await categorySelect.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByText("E2E food budget")).toBeVisible();

  await page.goto("/savings");
  await expect(page.getByRole("heading", { name: "Save for what matters." })).toBeVisible();
  await page.getByRole("button", { name: "New goal" }).click();
  await page.getByLabel("Goal name").fill("E2E laptop");
  await page.getByLabel("Target amount (INR)").fill("50000");
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByText("E2E laptop")).toBeVisible();

  await page.goto("/scheduled");
  await expect(page.getByRole("heading", { name: "Payments on your terms." })).toBeVisible();

  await page.goto("/scheduled/recurring");
  await expect(page.getByRole("heading", { name: "Patterns, not promises." })).toBeVisible();

  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "What's coming up." })).toBeVisible();

  await page.goto("/statements");
  await expect(page.getByRole("heading", { name: "Your records, ready to download." })).toBeVisible();
  await page.getByRole("button", { name: "Generate statement" }).click();
  await expect(page.getByText(/Statement test|E2E|→/).first()).toBeVisible({ timeout: 30_000 });
});
