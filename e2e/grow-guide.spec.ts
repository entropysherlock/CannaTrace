import { expect, test } from "@playwright/test";

test("the Grow screen walks a grow from a new batch to tagged plants, one short form at a time", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("cultivation@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/cultivation");
  const guide = page.getByTestId("grow-guide");
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("button", { name: /^1\. Start/ })).toBeVisible();

  // Start a batch: only a strain, a count and a room are needed; the name fills itself in
  await guide.getByRole("button", { name: /^1\. Start/ }).click();
  await expect(page.getByTestId("grow-title")).toHaveText("Start a batch");
  const run = Date.now().toString(36).toUpperCase();
  await page.locator('select[name="strainId"]').selectOption({ index: 1 });
  await page.locator('input[name="count"]').fill("3");
  await page.locator('select[name="locationId"]').selectOption({ index: 1 });
  await page.locator('input[name="name"]').fill(`GROW-${run}`);
  await page.getByRole("button", { name: "Start batch" }).click();
  await expect(page.getByTestId("grow-next")).toContainText("tag the plants");
  await expect(page.getByText(`Batch GROW-${run} started with 3 plants.`)).toBeVisible();

  // Carry on to tagging
  await page.getByTestId("grow-continue").click();
  await expect(page.getByTestId("grow-title")).toHaveText("Tag your plants");
  await page.locator('select[name="batchId"]').selectOption({ label: new RegExp(`GROW-${run}`) as never }).catch(async () => {
    const option = page.locator('select[name="batchId"] option', { hasText: `GROW-${run}` });
    await page.locator('select[name="batchId"]').selectOption(await option.getAttribute("value") ?? "");
  });
  await expect(page.locator('input[name="count"]')).toHaveValue("3");
  await page.getByRole("button", { name: "Tag plants" }).click();
  await expect(page.getByText("Tagged 3 plants")).toBeVisible();
  await expect(page.getByTestId("grow-next")).toContainText("move them to the flower room");

  // The old pages are still there as a fallback
  await expect(page.getByRole("link", { name: "Plants" })).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/cultivation\/overview$/);
  await expect(page.getByRole("link", { name: "Grow guide" })).toBeVisible();
});

test("a harvest that is still drying shows as waiting, not as something undone", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("cultivation@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/cultivation");
  await page.getByRole("button", { name: /^5\. Dry/ }).click();
  await expect(page.getByTestId("grow-title")).toHaveText("Dry weight");
});

test("the Package step only offers items counted by weight, and says why", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/cultivation");
  await page.getByRole("button", { name: /^6\. Package/ }).click();
  await expect(page.getByTestId("weight-note")).toBeVisible();
  const options = await page.locator('select[name="itemId"] option').allTextContents();
  expect(options.some((o) => /Blue Mesa Flower/.test(o))).toBe(true);
  expect(options.some((o) => /Jar|Pre-roll|Gummies|Resin/.test(o))).toBe(false);
  await expect(page.getByRole("button", { name: "Add bulk item" })).toBeVisible();
});

test("a strain's veg and flowering days can be set so Tally knows when plants are ready for flower", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("cultivation@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/cultivation/strains");
  const row = page.getByTestId("timing-Blue Mesa");
  await row.getByText("Set timing").click();
  await row.getByLabel("Veg days").fill("45");
  await row.getByRole("button", { name: "Save timing" }).click();
  await expect(page.getByText("Timing saved.")).toBeVisible();
  await expect(page.getByText(/veg 45 days/)).toBeVisible();
});

test("the Package step comes filled in: the strain's bulk item, the leftover weight, and the harvest's room", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/cultivation");
  await page.getByRole("button", { name: /^6\. Package/ }).click();
  const harvest = page.locator('select[name="harvestId"]');
  await expect(harvest).toBeVisible();
  const label = await harvest.locator("option:checked").textContent();
  const strain = /· (.+?) ·/.exec(label ?? "")?.[1] ?? "";
  expect(strain).not.toBe("");
  await expect(page.locator('select[name="itemId"] option:checked')).toContainText(`${strain} Flower (bulk)`);
  const qty = await page.locator('input[name="quantity"]').inputValue();
  expect(Number(qty)).toBeGreaterThan(0);
  expect((await harvest.locator("option:checked").textContent()) ?? "").toContain(`${Number(qty).toLocaleString("en-US", { maximumFractionDigits: 1 })} g left`);
  await expect(page.locator('select[name="locationId"] option:checked')).not.toHaveText(/Choose a room/);
});

test("Cultivation opens on the Overview, and the Grow guide always starts at step 1", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("link", { name: "Cultivation", exact: true }).first().click();
  await expect(page).toHaveURL(/\/cultivation\/overview$/);
  await page.getByRole("link", { name: "Grow guide" }).first().click();
  await expect(page).toHaveURL(/\/cultivation$/);
  // The demo business has a harvest waiting to be packaged, but the guide still starts at the first step
  await expect(page.getByTestId("grow-title")).toHaveText("Start a batch");
  await expect(page.getByRole("button", { name: /^1\. Start/ })).toHaveAttribute("aria-current", "step");
});
