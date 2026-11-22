import { expect, test } from "@playwright/test";

test("the legal pages are public, and the homepage and sign-in page link to them", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Terms of Service" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("not yet been reviewed by an attorney");

  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
  await expect(page.getByText("optional birthday (month and day only)")).toBeVisible();

  await page.getByRole("link", { name: "Data Agreement" }).click();
  await expect(page).toHaveURL(/\/data-agreement$/);
  await expect(page.getByRole("heading", { name: "Data Agreement", level: 1 })).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
});

test("signed-in people can open the legal pages too", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);
});
