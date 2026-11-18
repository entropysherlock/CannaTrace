import { expect, test } from "@playwright/test";

const run = `SMP${Date.now().toString(36).toUpperCase()}`;
const PASSWORD = "a-long-test-password";

test("an owner loads a full sample facility, switches to it, and finds every part filled in", async ({ page }) => {
  // A brand-new business, so the sample is the only data
  await page.goto("/signup");
  await page.locator('input[name="businessName"]').filter({ visible: true }).fill(`Sample Co ${run}`);
  await page.locator('input[name="facilityName"]').filter({ visible: true }).fill("My Real Store");
  await page.locator('input[name="licenseNumber"]').filter({ visible: true }).fill(`REAL-${run}`);
  await page.locator('select[name="licenseType"]').filter({ visible: true }).selectOption("RETAIL");
  await page.locator('select[name="state"]').filter({ visible: true }).selectOption("NM");
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Sample Owner");
  await page.locator('input[name="email"]').filter({ visible: true }).fill(`owner-${run}@e2e.test`);
  await page.locator('input[name="password"]').filter({ visible: true }).fill(PASSWORD);
  await page.locator('input[name="confirm"]').filter({ visible: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/settings/facilities");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Try every feature with sample data" }) });
  await card.getByRole("button", { name: "Load the sample facility" }).click();
  await expect(card.getByTestId("sample-loaded")).toContainText("Sample Grow & Store (practice data) is loaded", { timeout: 60_000 });
  await expect(card.getByRole("button", { name: "Load the sample facility" })).toHaveCount(0);
  const sample = page.locator("section", { has: page.getByRole("heading", { name: "Sample Grow & Store (practice data)" }) });
  await expect(sample.getByTestId("facility-rooms")).toContainText("Rooms (12)");
  await card.getByRole("button", { name: "Switch to the sample facility" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/cultivation/plants");
  await expect(page.getByText(/^8\d active tagged plants shown/)).toBeVisible();
  await page.goto("/cultivation/harvests");
  await expect(page.getByText("SS-H-1104")).toBeVisible();
  await expect(page.getByText("BM-H-1115")).toBeVisible();
  await page.goto("/inventory?q=SMP-000012");
  await expect(page.getByText("SMP-000012").first()).toBeVisible();
  await expect(page.getByText(/quarantin/i).filter({ visible: true }).first()).toBeVisible();
  await page.goto("/audit");
  await expect(page.getByTestId("scroll-box").last()).toContainText("Sample Owner");
});
