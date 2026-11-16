import { expect, test } from "@playwright/test";

const run = `CUL${Date.now().toString(36).toUpperCase()}`;

test("grow from a batch of clones to a packaged, finished harvest", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("cultivation@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Strain
  await page.goto("/cultivation/strains");
  await page.locator('input[name="name"]').fill(`Strain ${run}`);
  await page.locator('input[name="floweringDays"]').fill("60");
  await page.getByRole("button", { name: "Add strain" }).click();
  await expect(page.getByText(`Added Strain ${run}.`)).toBeVisible();

  // Batch of 4 clones
  await page.goto("/cultivation");
  const batchForm = page.locator('form:has(select[name="strainId"])');
  await batchForm.locator('input[name="name"]').fill(`${run}-BATCH`);
  await batchForm.locator('select[name="strainId"]').selectOption({ label: `Strain ${run}` });
  await batchForm.locator('input[name="count"]').fill("4");
  await batchForm.locator('select[name="locationId"]').selectOption({ label: "Clone Room" });
  await page.getByRole("button", { name: "Start batch" }).click();
  await expect(page.getByRole("heading", { name: `${run}-BATCH` })).toBeVisible();

  // Too many tags is refused; then tag 3 and record 1 lost
  await page.locator('input[name="firstTag"]').fill(`${run}-0001`);
  await page.locator('form:has(input[name="firstTag"]) input[name="count"]').fill("9");
  await page.getByRole("button", { name: "Tag plants" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("4 untagged plants left");
  await page.locator('form:has(input[name="firstTag"]) input[name="count"]').fill("3");
  await page.locator('form:has(input[name="firstTag"]) select[name="locationId"]').selectOption({ label: "Flower Room 1" });
  await page.getByRole("button", { name: "Tag plants" }).click();
  await expect(page.getByText(`Tagged 3 plants: ${run}-0001 to ${run}-0003.`)).toBeVisible();
  const lossForm = page.locator('form:has(input[name="reason"])');
  await lossForm.locator('input[name="count"]').fill("1");
  await lossForm.locator('input[name="reason"]').fill("Did not root");
  await page.getByRole("button", { name: "Record loss" }).click();
  await expect(page.getByText("Every plant in this batch has been tagged or accounted for.")).toBeVisible();

  // Plants: harvesting vegetative plants is refused, then flower and harvest
  await page.getByRole("link", { name: /tagged plants/ }).click();
  await expect(page.getByText("3 active tagged plants shown")).toBeVisible();
  await page.getByRole("button", { name: "Tick or untick all" }).click();
  await page.locator('select[name="bulkAction"]').selectOption("HARVEST");
  await page.locator('input[name="harvestName"]').fill(`${run}-H`);
  await page.locator('input[name="wetWeight"]').fill("2");
  await page.locator('select[name="dryLocationId"]').selectOption({ label: "Dry Room" });
  await page.getByRole("button", { name: "Apply to ticked plants" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Only flowering plants can be harvested");

  await page.locator('select[name="bulkAction"]').selectOption("FLOWERING");
  await page.getByRole("button", { name: "Apply to ticked plants" }).click();
  await expect(page.getByText("3 plants moved to flowering.")).toBeVisible();
  await expect(page.getByText("flowering", { exact: true })).toHaveCount(3);

  await page.getByRole("button", { name: "Tick or untick all" }).click();
  await page.locator('select[name="bulkAction"]').selectOption("HARVEST");
  await page.locator('input[name="harvestName"]').fill(`${run}-H`);
  await page.locator('input[name="wetWeight"]').fill("2");
  await page.locator('select[name="dryLocationId"]').selectOption({ label: "Dry Room" });
  await page.getByRole("button", { name: "Apply to ticked plants" }).click();
  await expect(page.getByRole("heading", { name: `${run}-H` })).toBeVisible();
  await expect(page.getByText("2 kg").first()).toBeVisible();

  // Harvest: waste, dry weight, package, finish
  const wasteForm = page.locator('form:has(input[name="reason"])');
  await wasteForm.locator('input[name="weight"]').fill("100");
  await wasteForm.locator('input[name="reason"]').fill("Stems");
  await page.getByRole("button", { name: "Log waste" }).click();
  await expect(page.getByText("Waste logged.")).toBeVisible();

  const dryForm = page.locator('form:has(button:text("Save dry weight"))');
  await dryForm.locator('input[name="weight"]').fill("500");
  await page.getByRole("button", { name: "Save dry weight" }).click();
  await expect(page.getByText("Dry weight saved.")).toBeVisible();
  await expect(page.getByText("400 g").first()).toBeVisible(); // on hand = 500 dry - 100 waste

  const packForm = page.locator('form:has(input[name="tag"])');
  await packForm.locator('input[name="tag"]').fill(`${run}-PKG`);
  await packForm.locator('select[name="itemId"]').selectOption({ label: "Mixed Trim (kg)" });
  await packForm.locator('input[name="quantity"]').fill("5");
  await page.getByRole("button", { name: "Create package" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("only 400 g of this harvest is left");
  await packForm.locator('input[name="quantity"]').fill("0.35");
  await page.getByRole("button", { name: "Create package" }).click();
  await expect(page.getByText(`Created package ${run}-PKG.`)).toBeVisible();

  await page.getByRole("button", { name: "Finish harvest" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("50 g of dried product is still unaccounted for");
  await wasteForm.locator('input[name="weight"]').fill("50");
  await wasteForm.locator('input[name="reason"]').fill("Trim");
  await page.getByRole("button", { name: "Log waste" }).click();
  await expect(page.getByText("Waste logged.")).toBeVisible();
  await page.getByRole("button", { name: "Finish harvest" }).click();
  await expect(page.getByText("finished", { exact: true })).toBeVisible();
  await expect(page.getByText("1.5 kg")).toBeVisible(); // moisture loss = 2000 - 150 - 350
  await expect(page.getByRole("button", { name: "Log waste" })).toHaveCount(0);

  // The package is in inventory with the harvest as its lot
  await page.getByRole("link", { name: `${run}-PKG` }).click();
  await expect(page.getByRole("heading", { name: `${run}-PKG` })).toBeVisible();
  await expect(page.getByText("0.35 kg").first()).toBeVisible();
  await expect(page.getByText(`${run}-H`).first()).toBeVisible();
});

test("a budtender does not see cultivation", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("budtender@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("link", { name: "Cultivation" })).toHaveCount(0);
  await page.goto("/cultivation/plants");
  await expect(page).toHaveURL(/\/dashboard/);
});
