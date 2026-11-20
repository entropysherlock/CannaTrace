import { expect, test } from "@playwright/test";
import sharp from "sharp";

const png = () => sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 240, g: 240, b: 235 } } }).png().toBuffer();

test("a photographed manifest fills in every package and receives them all in one tap", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();

  const run = Date.now().toString(36).toUpperCase();
  await page.goto("/capture");
  await page.getByTestId("file-input").setInputFiles({ name: `receive-manifest-${run}.png`, mimeType: "image/png", buffer: await png() });
  await expect(page.getByTestId("shots")).toContainText("Transport manifest", { timeout: 40_000 });
  await page.getByTestId("review-shot").first().click();

  const lines = page.getByTestId("manifest-lines").locator("li");
  await expect(lines).toHaveCount(2);
  await expect(page.getByTestId("manifest-receive")).toBeDisabled(); // nothing is chosen yet

  // Items and a location are needed; the two lines share a tag, which is refused with a clear message
  await page.getByTestId("manifest-location").selectOption({ index: 1 });
  for (const i of [1, 2]) await page.getByLabel(`Item for line ${i}`).selectOption({ index: 2 });
  await page.getByLabel("Tag for line 1").fill(`TESTA${run}`);
  await page.getByLabel("Tag for line 2").fill(`TESTA${run}`);
  await page.getByTestId("manifest-receive").click();
  await expect(page.getByText(/more than one line/)).toBeVisible();

  await page.getByLabel("Tag for line 2").fill(`TESTB${run}`);
  await page.getByTestId("manifest-receive").click();
  await expect(page.getByTestId("scan-done")).toContainText("Received 2 packages", { timeout: 20_000 });

  // They are real packages now
  await page.goto(`/inventory?q=TESTA${run}`);
  await expect(page.getByText(`TESTA${run}`).first()).toBeVisible();

  // And the manifest can't be received twice
  await page.goto("/inbox");
  await page.locator('[data-testid="inbox"] li', { hasText: `receive-manifest-${run}.png` }).first().getByRole("link", { name: /Open|Review/ }).first().click();
  await expect(page.getByTestId("already-saved")).toContainText("already received");
});
