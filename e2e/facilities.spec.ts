import { expect, test } from "@playwright/test";

const run = `FAC${Date.now().toString(36).toUpperCase()}`;

test("an owner adds a facility, switches to it, and changes its state", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Settings links to facility management, like Manage team
  await page.goto("/settings");
  await page.getByRole("link", { name: "Manage facilities" }).click();
  await expect(page).toHaveURL(/\/settings\/facilities$/);

  // Add a Colorado store
  const add = page.locator("section", { has: page.getByRole("heading", { name: "Add a facility" }) });
  // Only legal adult-use states with built-in rules are offered
  await expect(add.locator('select[name="state"] option', { hasText: "Wyoming" })).toHaveCount(0);
  await expect(add.locator('select[name="state"] option', { hasText: "Alabama" })).toHaveCount(0);
  await expect(add.locator('select[name="state"] option', { hasText: "Ohio" })).toHaveCount(1);

  await add.locator('input[name="name"]').fill(`${run} Denver Store`);
  await add.locator('input[name="licenseNumber"]').fill(`${run}-CO`);
  await add.locator('select[name="licenseType"]').selectOption("RETAIL");
  await add.locator('select[name="state"]').selectOption("CO");
  await add.getByRole("button", { name: "Add facility" }).click();
  await expect(add.getByRole("status")).toContainText(`Added ${run} Denver Store`);

  // A license already in use is refused
  await add.locator('input[name="name"]').fill(`${run} Copy`);
  await add.locator('input[name="licenseNumber"]').fill(`${run}-CO`);
  await add.locator('select[name="licenseType"]').selectOption("RETAIL");
  await add.locator('select[name="state"]').selectOption("CO");
  await add.getByRole("button", { name: "Add facility" }).click();
  await expect(add.getByRole("alert")).toContainText("already on another facility");

  // It shows in the facility menu; switch to it
  await page.reload();
  const card = page.locator("section", { has: page.getByRole("heading", { name: `${run} Denver Store` }) });
  await expect(card).toContainText("Colorado");
  await card.getByRole("button", { name: "Switch to this facility" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.locator("#facilityId option:checked")).toContainText(`${run} Denver Store`);

  // Change its state to Michigan
  await page.goto("/settings/facilities");
  await expect(card.getByText("You're here")).toBeVisible();
  await card.locator("summary", { hasText: "Edit this facility" }).click();
  await card.locator('select[name="state"]').selectOption("MI");
  await card.getByRole("button", { name: "Save facility" }).click();
  await expect(card.getByRole("status")).toContainText("Michigan's rules apply to this facility from now on");
  await page.reload();
  await expect(card.getByTestId("facility-details")).toContainText("Michigan");
});

test("an owner renames the business without touching facility names", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/settings");
  const name = page.getByRole("textbox", { name: "Business name" });
  await expect(name).toHaveValue("High Desert Demo Co.");
  await name.fill(`High Desert Cannabis ${run}`);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText(`Saved. Your business is now called High Desert Cannabis ${run}.`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Business name" })).toHaveValue(`High Desert Cannabis ${run}`);
  await expect(page.getByText("Rio Grande Grow & Lab").filter({ visible: true }).first()).toBeVisible();
  // Put it back for the other tests
  await page.getByRole("textbox", { name: "Business name" }).fill("High Desert Demo Co.");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Saved. Your business is now called High Desert Demo Co.")).toBeVisible();
});

test("an owner adds rooms to a facility by area type and renames one", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/settings/facilities");

  const card = page.locator("section", { has: page.getByText("You're here") });
  const rooms = card.getByTestId("facility-rooms");
  await rooms.locator("summary", { hasText: "Add a room" }).click();
  const area = rooms.getByRole("combobox", { name: "Room area type" }).last();
  await expect(area.locator("option")).toHaveText(["Choose one", "Propagation", "Vegetative", "Flowering", "Harvest", "Drying & Trimming", "Inventory", "Quarantine", "Waste"]);

  await area.selectOption({ label: "Drying & Trimming" });
  await rooms.getByRole("textbox", { name: "Room name" }).last().fill(`${run} Dry Room`);
  await rooms.getByRole("button", { name: "Add room" }).click();
  await expect(rooms.getByRole("status")).toContainText(`Added ${run} Dry Room (Drying & Trimming)`);

  // The same name twice is refused
  await area.selectOption({ label: "Waste" });
  await rooms.getByRole("textbox", { name: "Room name" }).last().fill(`${run} Dry Room`);
  await rooms.getByRole("button", { name: "Add room" }).click();
  await expect(rooms.getByRole("alert")).toContainText("already has a room or location");

  // Rename it and change its area
  await page.reload();
  const row = rooms.locator("li", { hasText: `${run} Dry Room` });
  await expect(row).toContainText("Drying & Trimming");
  await row.locator("summary").click();
  await row.getByRole("combobox", { name: "Room area type" }).selectOption({ label: "Quarantine" });
  await row.getByRole("textbox", { name: "Room name" }).fill(`${run} Hold Room`);
  await row.getByRole("button", { name: "Save room" }).click();
  // The row is now listed under its new name
  await expect(rooms.getByRole("status").filter({ hasText: `Saved ${run} Hold Room (Quarantine)` })).toBeVisible();

  // It is a room everywhere else too
  await page.goto("/locations");
  await expect(page.getByText(`${run} Hold Room`).locator("..")).toContainText("Quarantine");
});
