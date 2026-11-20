import { expect, test, type Page } from "@playwright/test";

const run = `FJ${Date.now().toString(36).toUpperCase()}`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function receive(page: Page, tag: string, item: string, quantity: string, lot: string) {
  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(tag);
  await page.locator('select[name="itemId"]').selectOption({ label: item });
  await page.locator('input[name="quantity"]').fill(quantity);
  await page.locator('select[name="locationId"]').selectOption({ index: 1 });
  await page.locator('input[name="lotNumber"]').fill(lot);
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: tag })).toBeVisible();
  return page.url();
}

test("tick many packages, one lab result for a lot, and pick a whole order at once", async ({ page }) => {
  await signIn(page, "manager@demo.test");
  const lot = `LOT-${run}`;
  const first = await receive(page, `${run}-1`, "Blue Mesa Flower (bulk) (g)", "50", lot);
  await receive(page, `${run}-2`, "Blue Mesa Flower (bulk) (g)", "50", lot);
  await receive(page, `${run}-3`, "Blue Mesa Flower (bulk) (g)", "50", lot);

  // Move all three in one go
  await page.goto(`/inventory?q=${run}`);
  const bulk = page.getByTestId("package-bulk");
  await bulk.getByRole("button", { name: "Tick or untick all" }).click();
  await page.locator('select[name="bulkAction"]').selectOption("MOVE");
  await page.locator('select[name="toLocationId"]').selectOption({ index: 2 });
  await page.getByRole("button", { name: "Apply to ticked packages" }).click();
  await expect(page.getByText("3 packages moved.")).toBeVisible();

  // Hold two of them; a reason is required
  await page.getByLabel(`Tick ${run}-1`).check();
  await page.getByLabel(`Tick ${run}-2`).check();
  await page.locator('select[name="bulkAction"]').selectOption("ON_HOLD");
  await page.locator('input[name="reason"]').fill("Recount");
  await page.getByRole("button", { name: "Apply to ticked packages" }).click();
  await expect(page.getByText("2 packages put on hold.")).toBeVisible();

  // One lab result, recorded on the whole lot
  await page.goto(first);
  await page.locator("summary", { hasText: "Add lab result" }).click();
  const sameLot = page.getByTestId("same-lot");
  await expect(sameLot).toContainText("Same test, rest of lot");
  await expect(sameLot.locator('input[name="alsoPackageId"]:checked')).toHaveCount(2);
  await page.locator('input[name="labName"]').fill("Mesa Analytical");
  await page.locator('form:has(input[name="labName"]) select[name="status"]').selectOption("PASS");
  await page.locator('input[name="thcPercent"]').fill("22");
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByText("Result saved for 3 packages.")).toBeVisible();
  await page.goto(`/inventory?q=${run}-3`);
  await page.getByRole("link", { name: `${run}-3` }).first().click();
  await expect(page.getByText("THC 22%")).toBeVisible();

  // Pick a whole order automatically
  const jars = [`${run}-J1`, `${run}-J2`];
  for (const tag of jars) await receive(page, tag, "Blue Mesa 3.5 g Jar (ea)", "10", `JAR-${run}`);
  await page.goto("/distribution/customers");
  await page.locator('input[name="name"]').fill(`Shop ${run}`);
  await page.locator('input[name="licenseNumber"]').fill(`LIC-${run}`);
  await page.locator('input[name="licenseType"]').fill("Retailer");
  await page.locator('input[name="licenseExpires"]').fill("2031-12-31");
  await page.locator('input[name="paymentTermsDays"]').fill("30");
  await page.locator('input[name="address"]').fill("1 Test Plaza, Santa Fe, NM");
  await page.getByRole("button", { name: "Add vendor" }).click();
  await page.getByRole("button", { name: "Mark license verified" }).click();
  await expect(page.getByText("License verified.")).toBeVisible();
  await page.goto("/distribution");
  await page.locator('select[name="destinationId"]').selectOption({ label: `Shop ${run} (LIC-${run.toUpperCase()})` });
  await page.getByRole("button", { name: "Start order" }).click();
  await expect(page.getByRole("heading", { name: /^SO-\d{5}$/ })).toBeVisible();
  await page.locator('select[name="itemId"]').selectOption({ label: "Blue Mesa 3.5 g Jar (ea)" });
  await page.locator('input[name="quantity"]').fill("5");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByRole("button", { name: "Confirm order" }).click();
  await page.getByRole("button", { name: "Pick everything, oldest first" }).click();
  await expect(page.getByText(/Picked 1 package, oldest first/)).toBeVisible();
  await expect(page.getByText("picked 5 of 5")).toBeVisible();
  await expect(page.getByText("Every line is picked.")).toBeVisible();
});

test("the harvest form makes several packages in one save", async ({ page }) => {
  await signIn(page, "cultivation@demo.test");
  await page.goto("/cultivation/harvests");
  await page.locator('a[href^="/cultivation/harvests/"]').first().click();
  await expect(page.locator('input[name="count"]')).toHaveValue("1");
  await expect(page.getByText("How many packages")).toBeVisible();
});
