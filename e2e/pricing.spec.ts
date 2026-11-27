import { expect, test } from "@playwright/test";

test("the pricing page is public and the homepage links to it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { name: "Simple pricing. No contracts." })).toBeVisible();
  await expect(page.getByTestId("price-per-facility")).toContainText("Per facility");
  await expect(page.getByTestId("price-per-facility")).toContainText("$299");
  await expect(page.getByTestId("included")).toContainText("Unlimited users");
  await expect(page.locator("body")).not.toContainText(/founding|days free|\$499|\$199/i);
});

test("signed-in people can open pricing too", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/pricing");
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId("price-per-facility")).toBeVisible();
});
