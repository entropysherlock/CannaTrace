import { expect, test, type Page } from "@playwright/test";

// "Create without leaving": a missing strain or room is added from inside Start a batch,
// without losing anything already typed, and without leaving the page.

const run = () => `CWL${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/cultivation");
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
