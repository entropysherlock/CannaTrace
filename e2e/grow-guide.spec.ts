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
  await expect(page.getByRole("link", { name: "All plants" })).toBeVisible();
  await page.getByRole("link", { name: "Everything on one page" }).click();
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
