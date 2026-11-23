import { expect, test } from "@playwright/test";

test("the account menu closes when you click anywhere else, or press Escape", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const link = page.getByRole("link", { name: "Password and phones" });
  await page.getByLabel("Your account").click();
  await expect(link).toBeVisible();
  // A click on the page, away from the menu
  await page.getByRole("main").click({ position: { x: 5, y: 5 } });
  await expect(link).toBeHidden();

  await page.getByLabel("Your account").click();
  await expect(link).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(link).toBeHidden();

  // Its own button still opens and closes it
  await page.getByLabel("Your account").click();
  await expect(link).toBeVisible();
  await page.getByLabel("Your account").click();
  await expect(link).toBeHidden();
});
