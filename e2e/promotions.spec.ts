import { expect, test } from "@playwright/test";

/** A manager adds an every-day promotion; it shows in the Promotions tab and can be turned off and deleted. */
test("promotions: add, turn off, delete", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page
    .locator('select[name="facilityId"]')
    .selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();
  await page.goto("/pos/promotions");
  await expect(page.getByRole("button", { name: "Add promotion" })).toBeVisible();

  const name = `E2E Deal ${Date.now().toString(36)}`;
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount").fill("100");
  await page.getByRole("button", { name: "Add promotion" }).click();
  await expect(page.getByText(/at most 90%/)).toBeVisible();

  await page.getByLabel("Amount").fill("15");
  await page.getByRole("button", { name: "Add promotion" }).click();
  const row = page
    .getByTestId("promotions")
    .getByRole("listitem")
    .filter({ hasText: name });
  await expect(row).toContainText("Running now");
  await expect(row).toContainText("15% off");

  await row.getByRole("button", { name: "Turn off" }).click();
  await expect(row).toContainText("Off");
  await row.getByRole("button", { name: `Delete ${name}` }).click();
  await expect(page.getByTestId("promotions").getByText(name)).toHaveCount(0);
});
