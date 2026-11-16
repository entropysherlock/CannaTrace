import { expect, test, type Page } from "@playwright/test";

const run = `MFG${Date.now().toString(36).toUpperCase()}`;

async function receive(page: Page, tag: string, item: string, quantity: string, cost: string) {
  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(tag);
  await page.locator('select[name="itemId"]').selectOption({ label: item });
  await page.locator('input[name="quantity"]').fill(quantity);
  await page.locator('select[name="locationId"]').selectOption({ label: "Packaging Line" });
  await page.locator('input[name="lotNumber"]').fill(`${run}-LOT`);
  await page.locator('input[name="costPerUnit"]').fill(cost);
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: tag })).toBeVisible();
}

test("save a recipe, run production, and get yield and cost", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("inventory@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await receive(page, `${run}-FLOWER`, "Blue Mesa Flower (bulk) (g)", "400", "1.2");
  await receive(page, `${run}-JARS`, "Empty 3.5 g Jar with Lid (ea)", "120", "0.35");

  // Recipe: 10 jars from 35 g of flower and 10 empty jars
  await page.goto("/manufacturing/recipes");
  await page.locator('input[name="name"]').fill(`Recipe ${run}`);
  await page.locator('select[name="outputItemId"]').selectOption({ label: "Blue Mesa 3.5 g Jar (ea)" });
  await page.locator('input[name="outputQuantity"]').fill("10");
  await page.getByLabel("Input item 1").selectOption({ label: "Blue Mesa Flower (bulk) (g)" });
  await page.getByLabel("Input quantity 1").fill("35");
  await page.getByLabel("Input item 2").selectOption({ label: "Empty 3.5 g Jar with Lid (ea)" });
  await page.getByLabel("Input quantity 2").fill("10");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText(`Saved recipe Recipe ${run}.`)).toBeVisible();
  await expect(page.getByText("35 g of Blue Mesa Flower (bulk)").last()).toBeVisible();

  // Run: 10 batches, plan 100 jars
  await page.goto("/manufacturing");
  await page.locator('input[name="name"]').fill(`${run}-RUN`);
  await page.locator('select[name="recipeId"]').selectOption({ label: `Recipe ${run}` });
  await page.locator('input[name="batches"]').fill("10");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByRole("heading", { name: `${run}-RUN` })).toBeVisible();
  await expect(page.getByText("0 of 350 g")).toBeVisible();

  // Inputs: a package outside the recipe is refused; then add both inputs
  const addForm = page.locator('form:has(input[name="tag"])');
  await addForm.locator('input[name="tag"]').fill("CT-000006");
  await addForm.locator('input[name="quantity"]').fill("1");
  await page.getByRole("button", { name: "Add to run" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("not in this run's recipe");

  await addForm.locator('input[name="tag"]').fill(`${run}-FLOWER`);
  await addForm.locator('input[name="quantity"]').fill("360");
  await page.getByRole("button", { name: "Add to run" }).click();
  await expect(page.getByText(`Added from ${run}-FLOWER. 40 left in that package.`)).toBeVisible();
  await expect(page.getByText("10 over")).toBeVisible();

  // Completing before the jars are recorded is refused
  const doneForm = page.locator('form:has(input[name="outputTag"])');
  await doneForm.locator('input[name="outputTag"]').fill(`${run}-OUT`);
  await doneForm.locator('input[name="actualQuantity"]').fill("96");
  await doneForm.locator('select[name="locationId"]').selectOption({ label: "Vault A" });
  await doneForm.locator('input[name="extraCost"]').fill("14.4");
  await page.getByRole("button", { name: "Complete run" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Nothing has been recorded for Empty 3.5 g Jar with Lid");

  // Take the flower back out, then put the right amount in
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Nothing added yet.")).toBeVisible();
  await addForm.locator('input[name="tag"]').fill(`${run}-FLOWER`);
  await addForm.locator('input[name="quantity"]').fill("350");
  await page.getByRole("button", { name: "Add to run" }).click();
  await expect(page.getByText(`Added from ${run}-FLOWER. 50 left in that package.`)).toBeVisible();
  await addForm.locator('input[name="tag"]').fill(`${run}-JARS`);
  await addForm.locator('input[name="quantity"]').fill("100");
  await page.getByRole("button", { name: "Add to run" }).click();
  await expect(page.getByText("$455.00 so far")).toBeVisible();

  // Complete: 96 of 100 planned; (455 + 14.40) / 96 = 4.89
  await page.getByRole("button", { name: "Complete run" }).click();
  await expect(page.getByText("96%")).toBeVisible();
  await expect(page.getByText("$4.89")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to run" })).toHaveCount(0);

  // Output package carries lot, cost, and lineage
  await page.getByRole("link", { name: new RegExp(`${run}-OUT`) }).click();
  await expect(page.getByRole("heading", { name: `${run}-OUT` })).toBeVisible();
  await expect(page.getByText("96 ea").first()).toBeVisible();
  await expect(page.getByText(`${run}-LOT`).first()).toBeVisible();
  await expect(page.getByText("Made from:")).toBeVisible();
  await expect(page.getByRole("link", { name: `${run}-FLOWER` })).toBeVisible();
});
