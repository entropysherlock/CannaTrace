import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const png = () => sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 240, g: 240, b: 235 } } }).png().toBuffer();

async function signIn(page: Page, email: string, facility?: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  if (facility) {
    await page.locator('select[name="facilityId"]').selectOption({ label: facility });
    await page.getByRole("button", { name: "Switch" }).click();
    await expect(page.getByText(facility.replace(" · ", " · license "))).toBeVisible();
  }
}

/** Upload a photo from the phone page and open its review. */
async function upload(page: Page, name: string, label: string) {
  await page.goto("/capture");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "image/png", buffer: await png() });
  await expect(page.getByTestId("shots")).toContainText(label, { timeout: 60_000 });
  await page.getByTestId("review-shot").first().click();
}

const GROW = "Rio Grande Grow & Lab · DEMO-CULT-0001";
const SHOP = "Sandia Storefront · DEMO-RET-0002";

test("an invoice sets the cost on the package it was for, and asks before replacing a cost", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "manager@demo.test", SHOP);
  await upload(page, `invoice-costs-${Date.now().toString(36)}.png`, "Invoice");
  const lines = page.getByTestId("invoice-lines").locator("li");
  await expect(lines).toHaveCount(1);
  // The seeded package already has a cost, so the line starts unticked with a warning
  await expect(lines.first()).toContainText("already has a cost");
  await expect(page.getByTestId("apply-button")).toBeDisabled();
  await page.getByLabel("Cost line 1").check();
  await page.getByLabel("Cost for line 1").fill("4.6");
  await page.getByTestId("apply-button").click();
  await expect(page.getByTestId("scan-done")).toContainText("Recorded costs on 1 package", { timeout: 20_000 });
  await page.goto("/inventory?q=CT-000103");
  await page.getByRole("link", { name: /CT-000103/ }).first().click();
  await expect(page.getByText("$4.60").first()).toBeVisible();
});

test("a license sets the expiry date on our facility and shows it on the Dashboard", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "manager@demo.test", SHOP);
  await upload(page, `retail-license-${Date.now().toString(36)}.png`, "License, permit or agent card");
  // Matched by its license number to our own store
  await expect(page.getByTestId("license-target")).toHaveValue(/^F:/);
  await expect(page.getByTestId("license-expires")).toHaveValue("2026-12-01");
  await page.getByTestId("apply-button").click();
  await expect(page.getByTestId("scan-done")).toContainText("expires 2026-12-01", { timeout: 20_000 });
  await page.goto("/dashboard");
  await expect(page.getByText(/Sandia Storefront's license (expired on|expires on) 2026-12-01/)).toBeVisible();
});

test("a price list adds the new products as items and saves every price to a list", async ({ page }) => {
  test.setTimeout(150_000);
  const run = Date.now().toString(36);
  await signIn(page, "manager@demo.test", GROW);
  await upload(page, `price-list-${run}.png`, "Vendor price list or catalog");
  const rows = page.getByTestId("price-rows").locator("li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Updates your item");
  await expect(rows.nth(1)).toContainText("new item");
  await page.getByTestId("price-new-name").fill(`Vendor prices ${run}`);
  await page.getByTestId("apply-button").click();
  await expect(page.getByTestId("scan-done")).toContainText(`Saved 2 prices to Vendor prices ${run}`, { timeout: 20_000 });
  await expect(page.getByTestId("scan-done")).toContainText("1 new item was added");
  await page.goto("/catalog");
  await expect(page.getByText(`Display Tray ${run.toUpperCase()}`).first().or(page.getByText(`Display Tray ${run}`).first())).toBeVisible();
});

test("a wholesale order becomes a draft order for the customer to confirm", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "manager@demo.test", GROW);
  await upload(page, `wholesale-order-${Date.now().toString(36)}.png`, "Wholesale order");
  await expect(page.getByTestId("order-customer")).not.toHaveValue("");
  const lines = page.getByTestId("order-lines").locator("li");
  await expect(lines).toHaveCount(2);
  await page.getByTestId("apply-button").click();
  await expect(page.getByTestId("scan-done")).toContainText(/Draft order SO-\d+ created/, { timeout: 20_000 });
  await page.getByRole("link", { name: "Review and confirm the order" }).click();
  await expect(page.getByText("Blue Mesa 3.5 g Jar").first()).toBeVisible();
  await expect(page.getByText(/DRAFT/i).first()).toBeVisible();
});

test("a harvest sheet records the harvest from the plant tags, and leaves out tags that aren't here", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "cultivation@demo.test", GROW);
  await upload(page, `harvest-sheet-${Date.now().toString(36)}.png`, "Harvest sheet");
  const rows = page.getByTestId("harvest-rows").locator("li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("No plant with this tag here");
  await expect(page.getByLabel("Harvest plant 3")).toBeDisabled();
  await page.getByTestId("harvest-name").fill(`SHEET-${Date.now().toString(36).toUpperCase()}`);
  await page.getByTestId("harvest-room").selectOption({ label: "Dry Room" });
  await page.getByTestId("apply-button").click();
  await expect(page.getByTestId("scan-done")).toContainText("Harvest recorded: 2 plants", { timeout: 20_000 });
  await page.goto("/cultivation/harvests");
  await expect(page.getByText(/SHEET-/).first()).toBeVisible();
});
