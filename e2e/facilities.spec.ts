import { expect, test } from "@playwright/test";

const run = `FAC${Date.now().toString(36).toUpperCase()}`;

test("an owner adds a facility, switches to it, and changes its state", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Settings links to facility management, like Manage team
  await page.goto("/settings");
  await page.getByRole("link", { name: "Manage facilities" }).click();
  await expect(page).toHaveURL(/\/settings\/facilities$/);

  // Add a Colorado store
  const add = page.locator("section", { has: page.getByRole("heading", { name: "Add a facility" }) });
  await add.locator('input[name="name"]').fill(`${run} Denver Store`);
  await add.locator('input[name="licenseNumber"]').fill(`${run}-CO`);
  await add.locator('select[name="licenseType"]').selectOption("RETAIL");
  await add.locator('select[name="state"]').selectOption("CO");
  await add.getByRole("button", { name: "Add facility" }).click();
  await expect(add.getByRole("status")).toContainText(`Added ${run} Denver Store`);

  // A license already in use is refused
  await add.locator('input[name="name"]').fill(`${run} Copy`);
  await add.locator('input[name="licenseNumber"]').fill(`${run}-CO`);
  await add.locator('select[name="licenseType"]').selectOption("RETAIL");
  await add.locator('select[name="state"]').selectOption("CO");
  await add.getByRole("button", { name: "Add facility" }).click();
  await expect(add.getByRole("alert")).toContainText("already on another facility");

  // It shows in the facility menu; switch to it
  await page.reload();
  const card = page.locator("section", { has: page.getByRole("heading", { name: `${run} Denver Store` }) });
  await expect(card).toContainText("Colorado");
  await card.getByRole("button", { name: "Switch to this facility" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.locator("#facilityId option:checked")).toContainText(`${run} Denver Store`);

  // Change its state to Michigan
  await page.goto("/settings/facilities");
  await expect(card.getByText("You're here")).toBeVisible();
  await card.locator("summary", { hasText: "Edit this facility" }).click();
  await card.locator('select[name="state"]').selectOption("MI");
  await card.getByRole("button", { name: "Save facility" }).click();
  await expect(card.getByRole("status")).toContainText("Michigan's rules apply to this facility from now on");
  await page.reload();
  await expect(card.getByTestId("facility-details")).toContainText("Michigan");
});
