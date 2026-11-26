import { expect, test } from "@playwright/test";

test("the pricing page is public and the homepage links to it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { name: "Simple pricing. No contracts." })).toBeVisible();
  await expect(page.getByTestId("founding-offer")).toHaveCount(0);
  await expect(page.getByTestId("price-1")).toContainText("1 facility");
  await expect(page.getByTestId("price-1")).toContainText("$299");
  await expect(page.getByTestId("price-2")).toContainText("2 facilities");
  await expect(page.getByTestId("price-2")).toContainText("$499");
  await expect(page.getByTestId("included")).toContainText("Unlimited team members");
});

test("signed-in people can open pricing too", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/pricing");
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId("price-2")).toBeVisible();
});
