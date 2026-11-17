import { expect, test } from "@playwright/test";

test("a visitor opens the live demo from the homepage without signing up", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Try the Live Demo" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
  await expect(page.getByRole("note")).toContainText("Live demo");
  await expect(page.getByText("Desert Bloom Cannabis Co. (sample)").or(page.getByText("Olivia Owner")).first()).toBeVisible();

  // Real work is allowed: the sample inventory is there to click around.
  await page.goto("/inventory");
  await expect(page.getByText("CT-000001").first()).toBeVisible();

  // Things that would affect other visitors or reach outside are locked.
  await page.goto("/team");
  await page.getByLabel("Their email").fill("someone@example.com");
  await page.getByRole("button", { name: /invite/i }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("switched off in the live demo");

  // Clicking the demo again keeps the visitor in the same sample business.
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Leave the demo" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("someone signed in to a real business is not moved into the demo", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("note")).toHaveCount(0);
});
