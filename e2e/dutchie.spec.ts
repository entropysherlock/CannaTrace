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

  // A new, empty facility points straight to the switch; so does Settings
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Switching from another system?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Switch from Flourish" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Switch from NMS2S" })).toBeVisible();
  await page.goto("/dashboard");
  await page.getByTestId("switch-banner").getByRole("link", { name: "Bring my data from Dutchie" }).click();
  await expect(page).toHaveURL(/\/data#switch-from-dutchie$/);
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Switch from Dutchie" }) });
  await card.locator('input[name="file"]').setInputFiles("tests/fixtures/dutchie-current-inventory.csv");
  await card.getByRole("button", { name: "Check the file" }).click();
  await expect(card.getByTestId("switch-preview")).toContainText("Ready to import: 4 packages, 3 new products");
  await expect(card.getByTestId("switch-preview")).toContainText("1A40E0100000A1B000000101");

  // Nothing is saved by checking
  await page.goto("/inventory");
  await expect(page.getByText("1A40E0100000A1B000000101")).toHaveCount(0);

  await page.goto("/data");
  await card.locator('input[name="file"]').setInputFiles("tests/fixtures/dutchie-current-inventory.csv");
  await card.getByRole("button", { name: "Check the file" }).click();
  await card.getByRole("button", { name: "Import 4 packages" }).click();
  await expect(card.getByTestId("switch-imported")).toContainText("Imported: 4 packages", { timeout: 30_000 });

  await page.goto("/inventory?q=1A40E0100000A1B000000101");
  await expect(page.getByText("Blue Dream 3.5g").first()).toBeVisible();

  // The Flourish box sits right beside it and reads a Flourish export
  await page.goto("/data");
  const flourish = page.locator("section", { has: page.getByRole("heading", { name: "Switch from Flourish" }) });
  await flourish.locator('input[name="file"]').setInputFiles("tests/fixtures/flourish-all-packages.csv");
  await flourish.getByRole("button", { name: "Check the file" }).click();
  await expect(flourish.getByTestId("switch-preview")).toContainText("Ready to import: 5 packages");

  // So does the NMS2S box, with the state system's 16-digit IDs
  const state = page.locator("section", { has: page.getByRole("heading", { name: "Switch from NMS2S (state system)" }) });
  await state.locator('input[name="file"]').setInputFiles("tests/fixtures/nms2s-inventory-room.csv");
  await state.getByRole("button", { name: "Check the file" }).click();
  await expect(state.getByTestId("switch-preview")).toContainText("Ready to import: 5 packages");
  await expect(state.getByTestId("switch-preview")).toContainText("scheduled for destruction");

  // Once there's inventory, the dashboard stops suggesting it
  await page.goto("/dashboard");
  await expect(page.getByTestId("switch-banner")).toHaveCount(0);
});
