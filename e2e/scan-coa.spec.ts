import { expect, test } from "@playwright/test";
import sharp from "sharp";

const png = () => sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 240, g: 240, b: 235 } } }).png().toBuffer();

test("a photographed lab certificate is read, checked, and saved to a package in a few taps", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();

  // The camera screen sends the photo and Tally reads it right away
  await page.goto("/capture");
  await page.getByTestId("camera-input").setInputFiles({ name: "coa-desert-haze.png", mimeType: "image/png", buffer: await png() });
  await expect(page.getByTestId("shots")).toContainText("Ready to review", { timeout: 40_000 });
  await expect(page.getByTestId("shots")).toContainText("Lab certificate");
  await expect(page.getByTestId("review-shot").first()).toBeVisible();

  // A receipt is not a certificate
  await page.getByTestId("file-input").setInputFiles({ name: "receipt-unreadable.png", mimeType: "image/png", buffer: await png() });
  await expect(page.getByTestId("shots")).toContainText("A store receipt", { timeout: 40_000 });

  // The inbox shows it needs a look; open it
  await page.goto("/inbox");
  const card = page.locator('[data-testid="inbox"] li', { hasText: "coa-desert-haze.png" }).first();
  await expect(card.getByTestId("scan-status")).toContainText("needs your check");
  await card.getByRole("link", { name: "Review", exact: true }).click();

  const review = page.getByTestId("coa-review");
  await expect(review).toBeVisible();
  await expect(page.getByTestId("field-labName")).toHaveValue("Sandia Analytical Labs");
  await expect(page.getByTestId("field-thcPercent")).toHaveValue("24.13");
  await expect(page.getByTestId("field-sampleDate")).toHaveValue("2026-11-02");
  await expect(page.getByTestId("result-PASS")).toHaveAttribute("aria-checked", "true");
  // Nothing saves until a package is chosen
  await expect(page.getByTestId("confirm-coa")).toBeDisabled();
  await page.getByRole("radiogroup", { name: "Package" }).getByRole("radio").first().check();
  // A correction by hand is kept
  await page.getByTestId("field-cbdPercent").fill("0.07");
  await page.getByTestId("confirm-coa").click();
  await expect(page.getByTestId("scan-done")).toContainText("Saved to");

  // It is saved: the inbox says so, and the receipt is explained, not filled in
  await page.goto("/inbox");
  await expect(page.locator('[data-testid="inbox"] li', { hasText: "coa-desert-haze.png" }).first().getByTestId("scan-status")).toContainText("Saved to a package");
  await page.locator('[data-testid="inbox"] li', { hasText: "receipt-unreadable.png" }).first().getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.getByTestId("not-supported")).toContainText("isn't a lab certificate");

  // Tidy up (the newest copy of each is the one this test made)
  await page.goto("/inbox");
  for (const name of ["coa-desert-haze.png", "receipt-unreadable.png"]) {
    const mine = page.locator('[data-testid="inbox"] li', { hasText: name });
    const before = await mine.count();
    await mine.first().getByRole("button", { name: "Delete" }).click();
    await expect(mine).toHaveCount(before - 1);
  }
});
