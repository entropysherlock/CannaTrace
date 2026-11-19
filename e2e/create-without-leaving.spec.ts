import { expect, test, type Page } from "@playwright/test";

// "Create without leaving": a missing strain or room is added from inside Start a batch,
// without losing anything already typed, and without leaving the page.

const run = () => `CWL${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;

async function signIn(page: Page, email: string, start = "/cultivation") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // Other tests may have left this person at another facility; the grow facility has the seeded rooms.
  const facility = page.getByRole("combobox", { name: "Facility" });
  if ((await facility.count()) && !(await facility.locator("option:checked").innerText()).includes("Rio Grande")) {
    const value = await facility.locator("option", { hasText: "Rio Grande" }).getAttribute("value");
    await facility.selectOption(value!);
    await page.getByRole("button", { name: "Switch" }).click();
    await expect(facility.locator("option:checked")).toContainText("Rio Grande");
  }
  await page.goto(start);
}

const batchForm = (page: Page) => page.locator('form:has(select[name="strainId"])');
const dialog = (page: Page) => page.getByRole("dialog");

/** Type into the parent form so each test can prove none of it is lost. */
async function fillParent(page: Page, name: string) {
  const form = batchForm(page);
  await form.locator('input[name="name"]').fill(name);
  await form.locator('select[name="source"]').selectOption("SEED");
  await form.locator('input[name="count"]').fill("7");
}

async function expectParentKept(page: Page, name: string) {
  const form = batchForm(page);
  await expect(form.locator('input[name="name"]')).toHaveValue(name);
  await expect(form.locator('select[name="source"]')).toHaveValue("SEED");
  await expect(form.locator('input[name="count"]')).toHaveValue("7");
}

async function strainCount(page: Page, name: string) {
  await page.goto("/cultivation/strains");
  return page.getByText(name, { exact: true }).count();
}

test("a manager adds a missing strain and room inside Start a batch, then starts it", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test");
  await fillParent(page, `${id}-BATCH`);

  // Strain
  await page.getByRole("button", { name: "Add strain" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel("Name")).toBeFocused();
  await dialog(page).getByLabel("Name").fill(`Strain ${id}`);
  await dialog(page).getByLabel("Type").selectOption("INDICA");
  await dialog(page).getByRole("button", { name: "Save strain" }).click();
  await expect(dialog(page)).toBeHidden();
  const strainSelect = batchForm(page).locator('select[name="strainId"]');
  await expect(strainSelect.locator("option:checked")).toHaveText(`Strain ${id}`);
  await expect(strainSelect).toBeFocused();
  await expectParentKept(page, `${id}-BATCH`);

  // Room
  await page.getByRole("button", { name: "Add room" }).click();
  await dialog(page).locator('input[name="name"]').fill(`Room ${id}`);
  await dialog(page).getByLabel("Room area type").selectOption("PROPAGATION");
  await dialog(page).getByRole("button", { name: "Save room" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(batchForm(page).locator('select[name="locationId"] option:checked')).toHaveText(`Room ${id}`);
  // The strain picked a moment ago is still picked, and so is everything else.
  await expect(strainSelect.locator("option:checked")).toHaveText(`Strain ${id}`);
  await expectParentKept(page, `${id}-BATCH`);

  await page.getByRole("button", { name: "Start batch" }).click();
  await expect(page.getByRole("heading", { name: `${id}-BATCH` })).toBeVisible();
  await expect(page.getByText(`Strain ${id}`).first()).toBeVisible();
  await expect(page.getByText(`Room ${id}`).first()).toBeVisible();

  // The new records are real everywhere else, too, and were each made once.
  expect(await strainCount(page, `Strain ${id}`)).toBe(1);
  await page.goto("/locations");
  await expect(page.getByText(`Room ${id}`, { exact: true })).toHaveCount(1);
  // Logged like any other new strain or room.
  await page.goto("/audit");
  await expect(page.getByText(/create\s+strain/).first()).toBeVisible();
  await expect(page.getByText(/create\s+location/).first()).toBeVisible();
});

test("cancelling, with Escape or the button, leaves the batch form as it was and saves nothing", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test");
  await fillParent(page, `${id}-BATCH`);
  await batchForm(page).locator('select[name="strainId"]').selectOption({ label: "Blue Mesa" });
  await batchForm(page).locator('select[name="locationId"]').selectOption({ label: "Clone Room" });

  const addStrain = page.getByRole("button", { name: "Add strain" });
  await addStrain.click();
  await dialog(page).getByLabel("Name").fill(`Never ${id}`);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(addStrain).toBeFocused();

  await addStrain.click();
  // The dialog opens fresh: nothing from the cancelled attempt.
  await expect(dialog(page).getByLabel("Name")).toHaveValue("");
  await dialog(page).getByLabel("Name").fill(`Never ${id}`);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toBeHidden();

  await expectParentKept(page, `${id}-BATCH`);
  await expect(batchForm(page).locator('select[name="strainId"] option:checked')).toHaveText("Blue Mesa");
  await expect(batchForm(page).locator('select[name="locationId"] option:checked')).toHaveText("Clone Room");
  expect(await strainCount(page, `Never ${id}`)).toBe(0);
});

test("a name that already exists is never added twice; the existing one is offered instead", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test");
  await fillParent(page, `${id}-BATCH`);

  // Different letter case and spacing is still the same strain.
  await page.getByRole("button", { name: "Add strain" }).click();
  await dialog(page).getByLabel("Name").fill("  blue   MESA ");
  await dialog(page).getByRole("button", { name: "Save strain" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Blue Mesa already exists, so nothing new was added.");
  await dialog(page).getByRole("button", { name: "Use Blue Mesa" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(batchForm(page).locator('select[name="strainId"] option:checked')).toHaveText("Blue Mesa");

  await page.getByRole("button", { name: "Add room" }).click();
  await dialog(page).locator('input[name="name"]').fill("clone room");
  await dialog(page).getByRole("button", { name: "Save room" }).click();
  await dialog(page).getByRole("button", { name: "Use Clone Room" }).click();
  await expect(batchForm(page).locator('select[name="locationId"] option:checked')).toHaveText("Clone Room");
  await expectParentKept(page, `${id}-BATCH`);

  expect(await strainCount(page, "Blue Mesa")).toBe(1);
  expect(await strainCount(page, "blue MESA")).toBe(0);
});

test("a server-side validation error shows in the dialog and keeps both forms filled in", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test");
  await fillParent(page, `${id}-BATCH`);
  await page.getByRole("button", { name: "Add strain" }).click();
  await dialog(page).getByLabel("Name").fill(`Strain ${id}`);
  await dialog(page).getByLabel("Flowering days (optional)").fill("soon");
  await dialog(page).getByRole("button", { name: "Save strain" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Flowering days must be a whole number");
  await expect(dialog(page).getByLabel("Name")).toHaveValue(`Strain ${id}`);
  await dialog(page).getByLabel("Flowering days (optional)").fill("63");
  await dialog(page).getByRole("button", { name: "Save strain" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(batchForm(page).locator('select[name="strainId"] option:checked')).toHaveText(`Strain ${id}`);
  await expectParentKept(page, `${id}-BATCH`);
});

test("a cultivation worker can add a strain but not a room, which needs a manager", async ({ page }) => {
  const id = run();
  await signIn(page, "cultivation@demo.test");
  await expect(page.getByRole("button", { name: "Add strain" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add room" })).toHaveCount(0);
  await expect(page.getByText("Room missing? Ask a manager to add it in Settings → Facilities.")).toBeVisible();

  await fillParent(page, `${id}-BATCH`);
  await page.getByRole("button", { name: "Add strain" }).click();
  await dialog(page).getByLabel("Name").fill(`Strain ${id}`);
  await dialog(page).getByRole("button", { name: "Save strain" }).click();
  await expect(batchForm(page).locator('select[name="strainId"] option:checked')).toHaveText(`Strain ${id}`);
  await expectParentKept(page, `${id}-BATCH`);
});

test("read-only staff get no Start a batch form and no add buttons", async ({ page }) => {
  await signIn(page, "readonly@demo.test");
  await expect(page.getByRole("button", { name: "Add strain" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add room" })).toHaveCount(0);
});

test("keyboard only: open, fill, save with Enter, and land back on the picker", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test");
  await fillParent(page, `${id}-BATCH`);
  await page.getByRole("button", { name: "Add strain" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByLabel("Name")).toBeFocused();
  await page.keyboard.type(`Strain ${id}`);
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeHidden();
  const strainSelect = batchForm(page).locator('select[name="strainId"]');
  await expect(strainSelect).toBeFocused();
  await expect(strainSelect.locator("option:checked")).toHaveText(`Strain ${id}`);
  // Enter in the dialog saved only the strain; the batch itself was not started.
  await expect(page).toHaveURL(/\/cultivation$/);
  await expectParentKept(page, `${id}-BATCH`);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the add form opens as a sheet that fits the screen and works by tap", async ({ page }) => {
    const id = run();
    await signIn(page, "manager@demo.test");
    await fillParent(page, `${id}-BATCH`);
    // Scroll the button clear of the phone's bottom bar and the Ask Tally button, as a person would.
    const addRoom = page.getByRole("button", { name: "Add room" });
    await addRoom.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    // Nothing on the page runs off the side of the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await addRoom.tap();
    const box = await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844 + 1);
    await dialog(page).locator('input[name="name"]').fill(`Room ${id}`);
    await dialog(page).getByRole("button", { name: "Save room" }).tap();
    await expect(dialog(page)).toBeHidden();
    await expect(batchForm(page).locator('select[name="locationId"] option:checked')).toHaveText(`Room ${id}`);
    await expectParentKept(page, `${id}-BATCH`);
  });
});

// ---------- The same pattern in the other modules ----------

test("cultivation: a room added while tagging plants out of a batch is picked for them", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test");
  await fillParent(page, `${id}-B`);
  await batchForm(page).locator('select[name="strainId"]').selectOption({ label: "Blue Mesa" });
  await batchForm(page).locator('select[name="locationId"]').selectOption({ label: "Clone Room" });
  await page.getByRole("button", { name: "Start batch" }).click();
  await expect(page.getByRole("heading", { name: `${id}-B` })).toBeVisible();

  const tagForm = page.locator('form:has(input[name="firstTag"])');
  await tagForm.locator('input[name="count"]').fill("2");
  await tagForm.getByRole("button", { name: "Add room" }).click();
  await dialog(page).locator('input[name="name"]').fill(`Veg ${id}`);
  await dialog(page).getByRole("button", { name: "Save room" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(tagForm.locator('select[name="locationId"] option:checked')).toHaveText(`Veg ${id}`);
  await expect(tagForm.locator('input[name="count"]')).toHaveValue("2");
  await page.getByRole("button", { name: "Tag plants" }).click();
  await expect(page.getByText(/^Tagged 2 plants/)).toBeVisible();
});

test("cultivation: moving ticked plants into a room added on the spot keeps the ticks", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test", "/cultivation/plants");
  const first = page.locator('input[name="plantId"]').first();
  await first.check();
  await page.locator('select[name="bulkAction"]').selectOption("MOVE");
  await page.getByRole("button", { name: "Add room" }).click();
  await dialog(page).locator('input[name="name"]').fill(`Flower ${id}`);
  await dialog(page).getByLabel("Room area type").selectOption("FLOWERING");
  await dialog(page).getByRole("button", { name: "Save room" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('select[name="locationId"] option:checked')).toHaveText(`Flower ${id}`);
  await expect(first).toBeChecked();
  await expect(page.locator('select[name="bulkAction"]')).toHaveValue("MOVE");
  await page.getByRole("button", { name: "Apply to ticked plants" }).click();
  await expect(page.getByText("1 plant moved.")).toBeVisible();
});

test("cultivation: packaging a harvest only offers weight units for a new item, and keeps the quantity", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test", "/cultivation/harvests");
  await page.getByRole("link", { name: /BM-1112/ }).first().click();
  const form = page.locator('form:has(input[name="quantity"]):has(select[name="itemId"])');
  await form.locator('input[name="quantity"]').fill("12");
  await form.getByRole("button", { name: "Add item" }).click();
  const units = await dialog(page).locator('select[name="unit"] option:not([disabled])').allTextContents();
  expect(units.length).toBeGreaterThan(0);
  expect(units.every((u) => /grams|ounces|pounds/.test(u))).toBe(true);
  await dialog(page).getByLabel("Item name").fill(`Bulk ${id}`);
  await dialog(page).locator('select[name="unit"]').selectOption("G");
  await dialog(page).getByRole("button", { name: "Save item" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(form.locator('select[name="itemId"] option:checked')).toHaveText(`Bulk ${id} (g)`);
  await expect(form.locator('input[name="quantity"]')).toHaveValue("12");

  // An existing item counted by the each can't be slipped in by name.
  await form.getByRole("button", { name: "Add item" }).click();
  await dialog(page).getByLabel("Item name").fill("blue mesa 3.5 g jar");
  await dialog(page).locator('select[name="unit"]').selectOption("G");
  await dialog(page).getByRole("button", { name: "Save item" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("can't be used here");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(form.locator('select[name="itemId"] option:checked')).toHaveText(`Bulk ${id} (g)`);
});

test("a cultivation worker packaging a harvest is told who can add a missing item", async ({ page }) => {
  await signIn(page, "cultivation@demo.test", "/cultivation/harvests");
  await page.getByRole("link", { name: /BM-1112/ }).first().click();
  await expect(page.getByText("Item missing? Someone who manages the catalog can add it on the Items page.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add item" })).toHaveCount(0);
});

test("inventory: receiving adds a missing item and location, then receives with everything kept", async ({ page }) => {
  const id = run();
  await signIn(page, "inventory@demo.test", "/inventory/receive");
  await page.locator('input[name="tag"]').fill(`${id}-PKG`);
  await page.locator('input[name="quantity"]').fill("40");
  await page.locator('input[name="lotNumber"]').fill(`LOT-${id}`);

  await page.getByRole("button", { name: "Add item" }).click();
  await dialog(page).getByLabel("Item name").fill(`Lozenge ${id}`);
  await dialog(page).locator('select[name="unit"]').selectOption("EACH");
  await dialog(page).locator('input[name="category"]').fill("CWL Edibles");
  await dialog(page).getByRole("button", { name: "Save item" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('select[name="itemId"] option:checked')).toHaveText(`Lozenge ${id} (ea)`);

  await page.getByRole("button", { name: "Add location" }).click();
  await dialog(page).locator('input[name="name"]').fill(`Bin ${id}`);
  await dialog(page).getByLabel("Type").selectOption("BIN");
  await dialog(page).getByRole("button", { name: "Save location" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('select[name="locationId"] option:checked')).toHaveText(`Bin ${id}`);

  await expect(page.locator('input[name="tag"]')).toHaveValue(`${id}-PKG`);
  await expect(page.locator('input[name="quantity"]')).toHaveValue("40");
  await expect(page.locator('input[name="lotNumber"]')).toHaveValue(`LOT-${id}`);
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: `${id}-PKG` })).toBeVisible();

  // The same name again is offered, not made twice.
  await page.goto("/inventory/receive");
  await page.getByRole("button", { name: "Add item" }).click();
  await dialog(page).getByLabel("Item name").fill(`lozenge ${id.toLowerCase()}`);
  await dialog(page).locator('select[name="unit"]').selectOption("EACH");
  await dialog(page).getByRole("button", { name: "Save item" }).click();
  await dialog(page).getByRole("button", { name: `Use Lozenge ${id} (ea)` }).click();
  await expect(page.locator('select[name="itemId"] option:checked')).toHaveText(`Lozenge ${id} (ea)`);
});

test("inventory: receiving a shipment adds a missing location without losing the manifest number", async ({ page }) => {
  const id = run();
  await signIn(page, "inventory@demo.test", "/inventory/receive/shipment");
  await page.locator('input[name="manifestNumber"]').fill(`MAN-${id}`);
  await page.getByRole("button", { name: "Add location" }).click();
  await dialog(page).locator('input[name="name"]').fill(`Dock ${id}`);
  await dialog(page).getByRole("button", { name: "Save location" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('select[name="locationId"] option:checked')).toHaveText(`Dock ${id}`);
  await expect(page.locator('input[name="manifestNumber"]')).toHaveValue(`MAN-${id}`);
});

test("distribution: an order line can use an item added on the spot; sales staff without catalog rights can't", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test", "/distribution");
  await page.locator('select[name="destinationId"]').selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start order" }).click();
  await expect(page.getByRole("heading", { name: /^SO-\d{5}$/ })).toBeVisible();
  const orderUrl = page.url();
  const line = page.locator('form:has(input[name="unitPrice"])');
  await line.locator('input[name="quantity"]').fill("6");
  await line.locator('input[name="unitPrice"]').fill("9.5");
  await line.getByRole("button", { name: "Add item" }).click();
  await dialog(page).getByLabel("Item name").fill(`Cone ${id}`);
  await dialog(page).locator('select[name="unit"]').selectOption("EACH");
  await dialog(page).getByRole("button", { name: "Save item" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(line.locator('select[name="itemId"] option:checked')).toHaveText(`Cone ${id} (ea)`);
  await expect(line.locator('input[name="quantity"]')).toHaveValue("6");
  await expect(line.locator('input[name="unitPrice"]')).toHaveValue("9.5");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("6 ea at $9.50 = $57.00")).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, "sales@demo.test", orderUrl);
  await expect(page.getByRole("button", { name: "Add item" })).toHaveCount(0);
  await expect(page.getByText("Item missing? Someone who manages the catalog can add it on the Items page.")).toBeVisible();
});

test("register: a menu item can be added to the catalog while setting its shelf price", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test", "/pos/menu");
  const form = page.locator('form:has(input[name="price"])');
  await form.locator('input[name="price"]').fill("25");
  await form.locator('select[name="limitCategory"]').selectOption("EDIBLE");
  await form.locator('input[name="limitPerUnit"]').fill("100");
  await form.getByRole("button", { name: "Add item" }).click();
  await dialog(page).getByLabel("Item name").fill(`Pastille ${id}`);
  await dialog(page).locator('select[name="unit"]').selectOption("EACH");
  await dialog(page).getByRole("button", { name: "Save item" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(form.locator('select[name="itemId"] option:checked')).toHaveText(`Pastille ${id} (ea)`);
  await expect(form.locator('input[name="price"]')).toHaveValue("25");
  await expect(form.locator('select[name="limitCategory"]')).toHaveValue("EDIBLE");
  await expect(form.locator('input[name="limitPerUnit"]')).toHaveValue("100");
  await page.getByRole("button", { name: "Save menu item" }).click();
  await expect(page.getByText("Menu item saved.")).toBeVisible();
});

// ---------- Guided drawers for records with many required fields ----------

const nextYear = `${new Date().getFullYear() + 1}-06-30`;

test("inventory: a vendor is added through the guided drawer while receiving, step by step", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test", "/inventory/receive");
  await page.locator('input[name="quantity"]').fill("3");
  await page.locator('input[name="note"]').fill(`note ${id}`);
  await page.getByRole("button", { name: "Add vendor" }).click();
  const drawer = dialog(page);
  await expect(drawer).toHaveAttribute("data-variant", "drawer");
  await expect(drawer.getByRole("list", { name: "Steps" }).locator('[aria-current="step"]')).toContainText("Business & license");

  // Next checks this step's required boxes before moving on.
  await drawer.getByRole("button", { name: "Next" }).click();
  await expect(drawer.locator('input[name="name"]')).toBeFocused();
  await expect(drawer.locator('input[name="phone"]')).toBeHidden();

  await drawer.locator('input[name="name"]').fill(`Grower ${id}`);
  await drawer.locator('input[name="licenseNumber"]').fill(`lic-${id}`);
  await drawer.locator('input[name="licenseType"]').fill("Producer");
  await drawer.locator('input[name="licenseExpires"]').fill(nextYear);
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.locator('input[name="phone"]').fill("505-555-0199");
  // Back keeps what was typed on the first step.
  await drawer.getByRole("button", { name: "Back" }).click();
  await expect(drawer.locator('input[name="name"]')).toHaveValue(`Grower ${id}`);
  await drawer.getByRole("button", { name: "Next" }).click();
  await expect(drawer.locator('input[name="phone"]')).toHaveValue("505-555-0199");
  await drawer.getByRole("button", { name: "Next" }).click();
  await expect(drawer.locator('input[name="verifyNow"]')).not.toBeChecked();
  await drawer.getByRole("button", { name: "Save vendor" }).click();
  await expect(drawer).toBeHidden();

  await expect(page.locator('select[name="vendorId"] option:checked')).toHaveText(`Grower ${id}`);
  await expect(page.locator('input[name="quantity"]')).toHaveValue("3");
  await expect(page.locator('input[name="note"]')).toHaveValue(`note ${id}`);

  // Saved like the Vendors tab: a vendor we buy from, license not yet verified.
  await page.goto("/distribution/customers");
  await page.getByRole("link", { name: new RegExp(`Grower ${id}`) }).click();
  await expect(page.getByText("license has not been verified yet")).toBeVisible();
});

test("inventory: a license already on file is never added twice; marking it 'we buy from' needs a yes", async ({ page }) => {
  await signIn(page, "manager@demo.test", "/inventory/receive");
  await page.locator('input[name="quantity"]').fill("5");
  await page.getByRole("button", { name: "Add vendor" }).click();
  const drawer = dialog(page);
  await drawer.locator('input[name="name"]').fill("Bosque (typed again)");
  await drawer.locator('input[name="licenseNumber"]').fill("demo-ret-0533");
  await drawer.locator('input[name="licenseType"]').fill("Retailer");
  await drawer.locator('input[name="licenseExpires"]').fill(nextYear);
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.getByRole("button", { name: "Save vendor" }).click();
  await expect(drawer.getByRole("alert")).toContainText("Bosque Wellness already has license DEMO-RET-0533");
  await drawer.getByRole("button", { name: "Mark Bosque Wellness as one you buy from and use it" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('select[name="vendorId"] option:checked')).toHaveText("Bosque Wellness");
  await expect(page.locator('input[name="quantity"]')).toHaveValue("5");
  await page.goto("/distribution/customers");
  await expect(page.getByText("Bosque (typed again)")).toHaveCount(0);
});

test("inventory staff can receive but are told who adds vendors", async ({ page }) => {
  await signIn(page, "inventory@demo.test", "/inventory/receive");
  await expect(page.getByRole("button", { name: "Add item" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add vendor" })).toHaveCount(0);
});

test("distribution: a new order can ship to a brand-new vendor or a new location of an existing one", async ({ page }) => {
  const id = run();
  await signIn(page, "sales@demo.test", "/distribution");
  await page.locator('input[name="notes"]').fill(`notes ${id}`);

  // A brand-new vendor; ticking the license check verifies it the same way the vendor page does.
  await page.getByRole("button", { name: "Add destination" }).click();
  const drawer = dialog(page);
  await drawer.locator('input[name="name"]').fill(`Shop ${id}`);
  await drawer.locator('input[name="licenseNumber"]').fill(`R-${id}`);
  await drawer.locator('input[name="licenseType"]').fill("Retailer");
  await drawer.locator('input[name="licenseExpires"]').fill(nextYear);
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.locator('input[name="verifyNow"]').check();
  await drawer.getByRole("button", { name: "Save and pick" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('select[name="destinationId"] option:checked')).toHaveText(`Shop ${id} (R-${id.toUpperCase()})`);
  await expect(page.locator('input[name="notes"]')).toHaveValue(`notes ${id}`);

  // Another licensed location for a vendor already on file.
  await page.getByRole("button", { name: "Add destination" }).click();
  await drawer.getByLabel("Who is it for?").selectOption({ label: "Another location for Turquoise Trail Dispensary" });
  await drawer.locator('input[name="destinationName"]').fill(`Uptown ${id}`);
  await drawer.locator('input[name="licenseNumber"]').fill(`U-${id}`);
  await drawer.locator('input[name="licenseType"]').fill("Retailer");
  await drawer.locator('input[name="licenseExpires"]').fill(nextYear);
  await drawer.getByRole("button", { name: "Next" }).click();
  await expect(drawer.locator('input[name="paymentTermsDays"]')).toHaveCount(0);
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.getByRole("button", { name: "Save and pick" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('select[name="destinationId"] option:checked')).toHaveText(`Turquoise Trail Dispensary – Uptown ${id} (U-${id.toUpperCase()})`);

  // An expired license can't be ticked as verified.
  await page.getByRole("button", { name: "Add destination" }).click();
  await drawer.locator('input[name="name"]').fill(`Old ${id}`);
  await drawer.locator('input[name="licenseNumber"]').fill(`X-${id}`);
  await drawer.locator('input[name="licenseType"]').fill("Retailer");
  await drawer.locator('input[name="licenseExpires"]').fill("2020-01-31");
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.locator('input[name="verifyNow"]').check();
  await drawer.getByRole("button", { name: "Save and pick" }).click();
  await expect(drawer.getByRole("alert")).toContainText("expired on 2020-01-31");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Start order" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^SO-\d{5}/ })).toBeVisible();
  // It ships to the new location, which wasn't ticked as checked, so the order says so.
  await expect(page.getByText(`Turquoise Trail Dispensary (Uptown ${id})'s license has not been verified yet`)).toBeVisible();
});

test("manufacturing: a recipe, and an item it needs, are added without leaving Start a new run", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test", "/manufacturing?new=1");
  await page.locator('input[name="name"]').fill(`RUN-${id}`);
  await page.locator('input[name="batches"]').fill("2");
  await page.getByRole("button", { name: "Add recipe" }).click();
  const drawer = page.getByRole("dialog", { name: "Add a recipe" });
  await drawer.locator('input[name="name"]').fill(`Rosin ${id}`);
  // The item it makes doesn't exist yet: a second dialog opens on top of the drawer.
  await drawer.getByRole("button", { name: "Add item" }).click();
  const itemDialog = page.getByRole("dialog", { name: "Add an item" });
  await itemDialog.getByLabel("Item name").fill(`Rosin Jar ${id}`);
  await itemDialog.locator('select[name="unit"]').selectOption("EACH");
  await itemDialog.getByRole("button", { name: "Save item" }).click();
  await expect(itemDialog).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('select[name="outputItemId"] option:checked')).toHaveText(`Rosin Jar ${id} (ea)`);
  await drawer.locator('input[name="outputQuantity"]').fill("10");
  await drawer.getByRole("button", { name: "Next" }).click();
  await drawer.getByLabel("Input item 1").selectOption({ label: "Blue Mesa Flower (bulk) (g)" });
  await drawer.getByLabel("Input quantity 1").fill("35");
  await drawer.getByRole("button", { name: "Save recipe" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('select[name="recipeId"] option:checked')).toHaveText(`Rosin ${id} (one batch makes 10 ea)`);
  await expect(page.locator('input[name="name"]').first()).toHaveValue(`RUN-${id}`);
  await expect(page.locator('input[name="batches"]')).toHaveValue("2");
});

test("catalog: a category is added while adding an item", async ({ page }) => {
  const id = run();
  await signIn(page, "inventory@demo.test", "/catalog");
  const form = page.locator('form:has(select[name="categoryId"])');
  await form.locator('input[name="name"]').fill(`Topical ${id}`);
  await form.getByRole("button", { name: "Add category" }).click();
  await dialog(page).getByLabel("Category name").fill(`Topicals ${id}`);
  await dialog(page).getByRole("button", { name: "Save category" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(form.locator('select[name="categoryId"] option:checked')).toHaveText(`Topicals ${id}`);
  await expect(form.locator('input[name="name"]')).toHaveValue(`Topical ${id}`);
});

test("SmartLabel: a template copy and a printer preset are added without losing the chosen records", async ({ page }) => {
  const id = run();
  await signIn(page, "manager@demo.test", "/labels?kind=PACKAGE");
  const firstRecord = page.locator('input[type="checkbox"]').first();
  await firstRecord.check();
  await page.getByRole("button", { name: "Add template" }).click();
  await dialog(page).getByLabel("Name for the new template").fill(`Pkg ${id}`);
  await dialog(page).getByRole("button", { name: "Save template" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByLabel("Template", { exact: true }).locator("option:checked")).toContainText(`Pkg ${id}`);
  await expect(firstRecord).toBeChecked();

  await page.getByRole("button", { name: "Add printer" }).click();
  await dialog(page).getByLabel("Printer name").fill(`Zebra ${id}`);
  await dialog(page).getByLabel("Shift right (mm)").fill("1.5");
  await dialog(page).getByRole("button", { name: "Save printer" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByLabel("Printer", { exact: true }).locator("option:checked")).toHaveText(`Zebra ${id}`);
  await expect(firstRecord).toBeChecked();
  await page.getByRole("button", { name: "Check and preview" }).click();
  await expect(page.getByText(/ready to print|labels? ready|Preview/i).first()).toBeVisible();
});

test("SmartLabel: people who only print can't add templates or printers", async ({ page }) => {
  await signIn(page, "budtender@demo.test", "/labels?kind=PACKAGE");
  await expect(page.getByRole("button", { name: "Add template" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add printer" })).toHaveCount(0);
});

test.describe("guided drawer on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("opens as a bottom sheet that fits and scrolls", async ({ page }) => {
    await signIn(page, "manager@demo.test", "/inventory/receive");
    const add = page.getByRole("button", { name: "Add vendor" });
    await add.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await add.tap();
    const box = await dialog(page).boundingBox();
    const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(view.w + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(view.h + 1);
    await expect(dialog(page).getByRole("button", { name: "Next" })).toBeInViewport();
  });
});
