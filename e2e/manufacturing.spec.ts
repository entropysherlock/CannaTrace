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
  await page.goto("/manufacturing/recipes?new=1");
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
  await expect(page.getByTestId("mfg-stats")).toContainText("In progress");
  // With runs already listed, the form opens from "New run"; on an empty facility it's open already
  if (await page.getByTestId("new-run").count()) await page.getByTestId("new-run").click();
  await expect(page.getByRole("heading", { name: "Start a new run" })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveValue(/^RUN-\d{8}-\d{2}$/);
  await page.locator('input[name="name"]').fill(`${run}-RUN`);
  const recipe = page.locator('select[name="recipeId"] option', { hasText: `Recipe ${run} (one batch makes 10 ea)` });
  await page.locator('select[name="recipeId"]').selectOption((await recipe.getAttribute("value"))!);
  await page.locator('input[name="batches"]').fill("10");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByRole("heading", { name: `${run}-RUN` })).toBeVisible();
  await expect(page.getByText("0 of 350 g")).toBeVisible();

  // Inputs: a package outside the recipe is refused; then add both inputs
  const addForm = page.locator('form:has([name="tag"])');
  // The list only offers packages that fit the recipe; one outside it is typed (or scanned) instead
  await expect(addForm.locator('select[name="tag"] option', { hasText: "CT-000006" })).toHaveCount(0);
  await addForm.getByRole("button", { name: "Type or scan a tag instead" }).click();
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
  await page.getByRole("button", { name: /^2\. Finish/ }).click();
  const doneForm = page.locator('form:has(input[name="outputTag"])');
  await doneForm.locator('input[name="outputTag"]').fill(`${run}-OUT`);
  await doneForm.locator('input[name="actualQuantity"]').fill("96");
  await doneForm.locator('select[name="locationId"]').selectOption({ label: "Vault A" });
  await doneForm.locator("summary").click();
  await doneForm.locator('input[name="extraCost"]').fill("14.4");
  await page.getByRole("button", { name: "Complete run" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Nothing has been recorded for Empty 3.5 g Jar with Lid");

  // Take the flower back out, then put the right amount in
  await page.getByRole("button", { name: /^1\. Add inputs/ }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Nothing added yet.")).toBeVisible();
  await addForm.locator('select[name="tag"]').selectOption(`${run}-FLOWER`);
  await expect(addForm.locator('input[name="quantity"]')).toHaveValue("350"); // what the recipe still needs
  await addForm.locator('input[name="quantity"]').fill("350");
  await page.getByRole("button", { name: "Add to run" }).click();
  await expect(page.getByText(`Added from ${run}-FLOWER. 50 left in that package.`)).toBeVisible();
  await addForm.locator('select[name="tag"]').selectOption(`${run}-JARS`);
  await addForm.locator('input[name="quantity"]').fill("100");
  await page.getByRole("button", { name: "Add to run" }).click();
  await expect(page.getByText("$455.00 so far")).toBeVisible();

  // Complete: 96 of 100 planned; (455 + 14.40) / 96 = 4.89
  await page.getByRole("button", { name: /^2\. Finish/ }).click();
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

  // The overview lists it as completed, and search and the status filter find it
  await page.goto(`/manufacturing?status=COMPLETED&q=${run}`);
  const row = page.getByTestId("run-row").filter({ hasText: `${run}-RUN` });
  await expect(row).toContainText("96 ea");
  await expect(row).toContainText("96%");
  await page.goto(`/manufacturing?status=IN_PROGRESS&q=${run}`);
  await expect(page.getByText(`No runs match "${run}"`)).toBeVisible();
});

test("a recipe can add the items it needs without leaving the form", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/manufacturing/recipes?new=1");

  await page.locator('input[name="name"]').fill(`Rosin ${run}`);
  // What it makes: a brand-new product
  // Each picker has its own "+ Add item"; the first is beside "What it makes".
  await page.getByRole("button", { name: "Add item" }).nth(0).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Item name").fill(`Live Rosin ${run}`);
  await dialog.locator('select[name="unit"]').selectOption("G");
  await dialog.locator('input[name="category"]').fill("Concentrates");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("What it makes")).toHaveValue(/.+/);
  await expect(page.getByLabel("What it makes").locator("option:checked")).toHaveText(`Live Rosin ${run} (g)`);
  await page.locator('input[name="outputQuantity"]').fill("20");

  // Input 1: another new item; input 2: an existing one, which can now be picked in any row
  await page.getByRole("button", { name: "Add item" }).nth(1).click();
  await dialog.getByLabel("Item name").fill(`Fresh Frozen ${run}`);
  await dialog.locator('select[name="unit"]').selectOption("G");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Input item 1").locator("option:checked")).toHaveText(`Fresh Frozen ${run} (g)`);
  await page.getByLabel("Input quantity 1").fill("100");
  await page.getByLabel("Input item 2").selectOption({ label: "Empty 3.5 g Jar with Lid (ea)" });
  await page.getByLabel("Input quantity 2").fill("20");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText(`Saved recipe Rosin ${run}.`)).toBeVisible();
  await expect(page.getByText(`100 g of Fresh Frozen ${run}`)).toBeVisible();

  // Both new items are in the catalog
  await page.goto("/catalog");
  await expect(page.getByText(`Live Rosin ${run}`)).toBeVisible();
  await expect(page.getByText(`Fresh Frozen ${run}`)).toBeVisible();
});
