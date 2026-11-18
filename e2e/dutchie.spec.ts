import { expect, test } from "@playwright/test";

const run = `DUT${Date.now().toString(36).toUpperCase()}`;
const PASSWORD = "a-long-test-password";

test("a store switching from Dutchie checks its inventory report, then imports it", async ({ page }) => {
  await page.goto("/signup");
  await page.locator('input[name="businessName"]').filter({ visible: true }).fill(`Dutchie Switch ${run}`);
  await page.locator('input[name="facilityName"]').filter({ visible: true }).fill("Sandia Store");
  await page.locator('input[name="licenseNumber"]').filter({ visible: true }).fill(`DUT-${run}`);
  await page.locator('select[name="licenseType"]').filter({ visible: true }).selectOption("RETAIL");
  await page.locator('select[name="state"]').filter({ visible: true }).selectOption("NM");
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Store Owner");
  await page.locator('input[name="email"]').filter({ visible: true }).fill(`owner-${run}@e2e.test`);
  await page.locator('input[name="password"]').filter({ visible: true }).fill(PASSWORD);
  await page.locator('input[name="confirm"]').filter({ visible: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/data");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Switch from Dutchie" }) });
  await card.locator('input[name="file"]').setInputFiles("tests/fixtures/dutchie-current-inventory.csv");
  await card.getByRole("button", { name: "Check the file" }).click();
  await expect(card.getByTestId("dutchie-preview")).toContainText("Ready to import: 4 packages, 3 new products");
  await expect(card.getByTestId("dutchie-preview")).toContainText("1A40E0100000A1B000000101");

  // Nothing is saved by checking
  await page.goto("/inventory");
  await expect(page.getByText("1A40E0100000A1B000000101")).toHaveCount(0);

  await page.goto("/data");
  await card.locator('input[name="file"]').setInputFiles("tests/fixtures/dutchie-current-inventory.csv");
  await card.getByRole("button", { name: "Check the file" }).click();
  await card.getByRole("button", { name: "Import 4 packages" }).click();
  await expect(card.getByTestId("dutchie-imported")).toContainText("Imported: 4 packages", { timeout: 30_000 });

  await page.goto("/inventory?q=1A40E0100000A1B000000101");
  await expect(page.getByText("Blue Dream 3.5g").first()).toBeVisible();
});
