import { expect, test } from "@playwright/test";
import sharp from "sharp";

const png = () => sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 240, g: 240, b: 235 } } }).png().toBuffer();

test("Tally recognises manifests, invoices and licenses, checks them, and keeps IDs unread", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();

  await page.goto("/capture");
  const buffer = await png();
  for (const name of ["supplier-invoice.png", "rio-grande-manifest.png", "retail-license.png", "customer-id-card.png"]) {
    await page.getByTestId("file-input").setInputFiles({ name, mimeType: "image/png", buffer });
  }
  const shots = page.getByTestId("shots");
  await expect(shots).toContainText("Invoice or packing slip: Invoice INV-77", { timeout: 60_000 });
  await expect(shots).toContainText("Transport manifest: Delivery manifest from Rio Grande Distribution");
  await expect(shots).toContainText("License, permit or agent card");
  await expect(shots).toContainText("Customer ID or patient card");

  // The invoice's arithmetic is checked
  await page.goto("/inbox");
  await page.locator('[data-testid="inbox"] li', { hasText: "supplier-invoice.png" }).first().getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.getByTestId("invoice-apply")).toContainText("Mesa Packaging");
  await expect(page.getByTestId("invoice-apply")).toContainText("INV-77");
  await expect(page.getByTestId("doc-warnings")).toContainText("line 2");
  await expect(page.getByTestId("invoice-lines").locator("li")).toHaveCount(2);

  // The manifest's repeated tag is caught
  await page.goto("/inbox");
  await page.locator('[data-testid="inbox"] li', { hasText: "rio-grande-manifest.png" }).first().getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.getByTestId("doc-warnings")).toContainText("appears more than once");

  // A license close to expiry says so; an ID is never read
  await page.goto("/inbox");
  await page.locator('[data-testid="inbox"] li', { hasText: "retail-license.png" }).first().getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.getByTestId("doc-warnings")).toContainText(/expire/);
  await page.goto("/inbox");
  await page.locator('[data-testid="inbox"] li', { hasText: "customer-id-card.png" }).first().getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.getByTestId("doc-review")).toContainText("doesn't read or store personal ID details");
  await expect(page.getByTestId("doc-review")).not.toContainText("Should never be shown");

  for (const name of ["supplier-invoice.png", "rio-grande-manifest.png", "retail-license.png", "customer-id-card.png"]) {
    await page.goto("/inbox");
    const card = page.locator('[data-testid="inbox"] li', { hasText: name }).first();
    if (await card.count()) await card.getByRole("button", { name: /delete/i }).click().catch(() => undefined);
  }
});
