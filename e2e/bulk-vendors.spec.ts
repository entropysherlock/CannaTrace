import { expect, test, type Page } from "@playwright/test";

const run = Date.now().toString(36).toUpperCase();

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("vendors have destinations, and orders ship to a chosen destination", async ({ page }) => {
  await signIn(page, "sales@demo.test");
  await page.goto("/distribution/customers");
  await expect(page.getByRole("heading", { name: "Vendors" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Turquoise Trail Dispensary/ })).toContainText("2 destinations · 2 ready to ship");
  await expect(page.getByRole("link", { name: /Sandoval Packaging Supply/ })).toContainText("we buy from");

  // Add a third destination and verify it
  await page.getByRole("link", { name: /Turquoise Trail Dispensary/ }).click();
  await page.locator("summary", { hasText: "Add a destination" }).click();
  const form = page.locator("details", { hasText: "Add a destination" });
  await form.getByRole("textbox", { name: "Name" }).fill(`Los Lunas ${run}`);
  await form.getByRole("textbox", { name: "License number" }).fill(`LL-${run}`);
  await form.getByRole("textbox", { name: "License type" }).fill("Retailer");
  await form.locator('input[name="licenseExpires"]').fill("2031-06-30");
  await form.getByRole("button", { name: "Add destination" }).click();
  const card = page.getByRole("listitem", { name: `Destination Los Lunas ${run}` });
  await expect(card).toContainText("license has not been verified yet");
  await card.getByRole("button", { name: "Mark license verified" }).click();
  await expect(card).toContainText("License verified");

  // Start an order to that destination
  await page.goto("/distribution");
  await page.locator('select[name="destinationId"]').selectOption({ label: `Turquoise Trail Dispensary – Los Lunas ${run} (LL-${run})` });
  await page.getByRole("button", { name: "Start order" }).click();
  await expect(page.getByRole("heading", { name: /^SO-\d{5}/ })).toBeVisible();
  await expect(page.getByText(`Turquoise Trail Dispensary – Los Lunas ${run} · started by`)).toBeAttached();
});

test("Tally bulk-edits items with one confirmation card", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  await page.keyboard.press("Control+j");
  const panel = page.getByRole("dialog", { name: "Leaf2Sale assistant" });
  await panel.getByLabel("Message the assistant").fill(`change category of Pre-roll to Joints ${run}`);
  await panel.getByLabel("Message the assistant").press("Enter");
  const card = panel.locator("div", { hasText: /Change \d+ items?/ }).filter({ has: page.getByRole("button", { name: "Confirm" }) }).last();
  await expect(card).toContainText("Desert Haze 1 g Pre-roll");
  await expect(card).toContainText(`→ joints ${run.toLowerCase()}`);
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(panel.getByText(/Updated \d+ items?\./)).toBeVisible();
  await page.goto("/catalog");
  await expect(page.getByText(`joints ${run.toLowerCase()}`).first()).toBeVisible();
});
