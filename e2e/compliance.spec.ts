import { expect, test } from "@playwright/test";

const run = `CMP${Date.now().toString(36).toUpperCase()}`;
const seen = (page: import("@playwright/test").Page, text: string | RegExp) => page.getByText(text).filter({ visible: true }).first();

test("state reporting: practice mode sends, NMS2S lists records for hand entry", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Seeded opening records were sent in practice mode
  await page.getByRole("link", { name: "Compliance" }).first().click();
  await expect(page.getByRole("heading", { name: "State reporting" })).toBeVisible();
  await expect(seen(page, "Practice mode. Records are marked as sent")).toBeVisible();
  await expect(seen(page, "Received package CT-000001: 4536 g")).toBeVisible();

  // Send anything other tests left waiting, so the counts below are only this test's
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(seen(page, /^Done/)).toBeVisible();

  // Switch to NMS2S and make a change
  await page.locator('select[name="system"]').selectOption("NMS2S");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(seen(page, "Saved. Records from now on go to the system you chose.")).toBeVisible();

  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(`${run}-A`);
  await page.locator('select[name="itemId"]').selectOption({ label: "Mixed Trim (kg)" });
  await page.locator('input[name="quantity"]').fill("2");
  await page.locator('select[name="locationId"]').selectOption({ label: "Dry Room" });
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: `${run}-A` })).toBeVisible();

  await page.goto("/compliance");
  await expect(seen(page, `Received package ${run}-A: 2 kg`)).toBeVisible();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(seen(page, "Done: 1 need entering by hand.")).toBeVisible();
  await expect(seen(page, "has not published the full NMS2S API")).toBeVisible();

  // The dashboard warns about it
  await page.goto("/dashboard");
  await expect(seen(page, "1 to enter by hand")).toBeVisible();

  // Mark it entered
  await page.goto("/compliance");
  await page.getByRole("button", { name: "Entered" }).click();
  await expect(seen(page, "Nothing needs entering by hand.")).toBeVisible();

  // Back to practice mode for the other tests
  await page.locator('select[name="system"]').selectOption("MOCK");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(seen(page, "Saved. Records from now on")).toBeVisible();
});

test("the scheduled sync route refuses calls without the secret", async ({ request }) => {
  const response = await request.get("/api/sync/run");
  expect(response.status()).toBe(401);
  const wrong = await request.get("/api/sync/run", { headers: { Authorization: "Bearer wrong" } });
  expect(wrong.status()).toBe(401);
});

test("a read-only user can see state reporting but not change it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("readonly@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/compliance");
  await expect(page.getByRole("heading", { name: "State reporting" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send now" })).toHaveCount(0);
  await expect(page.locator('select[name="system"]')).toHaveCount(0);
});
