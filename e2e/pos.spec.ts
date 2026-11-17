import { expect, test, type Page } from "@playwright/test";

async function signInAtShop(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();
}

/** What a 2D scanner types when it reads the back of a New Mexico driver's license. */
const LICENSE = (birth: string) =>
  `@\n\x1e\rANSI 636014080102DL00410288ZC03290034DLDAQD1234562\nDCSRIVERA\nDACMARISOL\nDBB${birth}\nDBA03142031\nDAJNM\nDCGUSA\n`;

/** A scanner types fast and ends with Enter. Click empty space first so no text box has focus. */
async function scan(page: Page, text: string) {
  await page.locator("body").click({ position: { x: 2, y: 400 } });
  await page.keyboard.type(text, { delay: 2 });
}

async function typeDates(page: Page, birth: string, expires = "2031-06-30") {
  await page.getByRole("button", { name: /Type the dates/ }).click();
  await page.getByLabel("Date of birth on the ID").fill(birth);
  await page.getByLabel("ID expiry date").fill(expires);
}

const cart = (page: Page) => page.getByRole("complementary", { name: "Cart" });
const qtyOf = (page: Page, name: string) => cart(page).getByRole("group", { name: `Quantity of ${name}` }).getByTestId("line-qty");

test("a full shift on the touch register: ID scan, barcode scan, limits, discount, cash, void, split, hold, close out", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAtShop(page, "manager@demo.test");
  await page.goto("/pos");

  // Open the drawer
  await page.getByLabel("Starting cash").fill("200");
  await page.getByRole("button", { name: "Open drawer" }).click();
  await expect(page.getByText("Scan the barcode on the back of the ID")).toBeVisible();

  // Under 21, typed by hand: refused, and the sale cannot start
  const year = new Date().getFullYear();
  await typeDates(page, `${year - 20}-01-01`);
  await expect(page.getByRole("alert").filter({ hasText: "The minimum age is 21" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start sale" })).toBeDisabled();
  await page.getByRole("button", { name: "Clear" }).click();

  // Driver's license scan fills in the check
  await scan(page, LICENSE("03141988"));
  await expect(page.getByText("Marisol Rivera")).toBeVisible();
  await expect(page.getByText(/Age \d+ · OK to serve/)).toBeVisible();
  await page.getByRole("button", { name: "Start sale" }).click();
  await expect(page.getByRole("heading", { name: /^Cart S-\d{5}$/ })).toBeVisible();

  // A barcode scan by SKU adds one
  await scan(page, "FLW-BM-35\n");
  await expect(page.getByRole("status").filter({ hasText: "Added Blue Mesa 3.5 g Jar" })).toBeVisible();
  await expect(qtyOf(page, "Blue Mesa 3.5 g Jar")).toHaveText("1");

  // Purchase limit: 16 jars is 56 g; a 17th would be 59.5 g, over 56.7 g
  for (let n = 2; n <= 16; n++) {
    await cart(page).getByRole("button", { name: "One more Blue Mesa 3.5 g Jar" }).click();
    await expect(qtyOf(page, "Blue Mesa 3.5 g Jar")).toHaveText(String(n));
  }
  await cart(page).getByRole("button", { name: "One more Blue Mesa 3.5 g Jar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "59.5 g of flower. The limit is 56.7 g per purchase" })).toBeVisible();
  await expect(qtyOf(page, "Blue Mesa 3.5 g Jar")).toHaveText("16");
  await cart(page).getByRole("button", { name: "Remove Blue Mesa 3.5 g Jar" }).click();
  await expect(qtyOf(page, "Blue Mesa 3.5 g Jar")).toHaveCount(0);

  // Tap products on the grid
  await page.getByRole("button", { name: /^Add Blue Mesa 3.5 g Jar/ }).click();
  await expect(qtyOf(page, "Blue Mesa 3.5 g Jar")).toHaveText("1");
  await page.getByRole("button", { name: /^Add Blue Mesa 3.5 g Jar/ }).click();
  await expect(qtyOf(page, "Blue Mesa 3.5 g Jar")).toHaveText("2");
  await page.getByRole("tab", { name: "Edibles" }).click();
  await expect(page.getByRole("button", { name: /^Add Blue Mesa/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Add Prickly Pear Gummies 10-pack/ }).click();
  await expect(cart(page).getByText("7 of 56.7 g")).toBeVisible();
  await expect(cart(page).getByText("100 of 800 mg")).toBeVisible();

  // Discount: 92.00 - 9.20 = 82.80; excise 12% = 9.94; sales tax 7.5% = 6.21; total 98.95
  await page.getByRole("radio", { name: "Veteran 10%" }).click();
  await expect(cart(page).getByText("-$9.20")).toBeVisible();
  await expect(page.getByRole("button", { name: /Pay.*\$98\.95/ })).toBeVisible();

  // The customer screen shows the cart
  const display = await page.context().newPage();
  await display.goto("/pos/display");
  await expect(display.getByText("Prickly Pear Gummies 10-pack")).toBeVisible();
  await expect(display.getByText("$98.95")).toBeVisible();

  // Pay cash with F2: too little cannot complete; then change is shown
  await page.bringToFront();
  await page.keyboard.press("F2");
  const pay = page.getByRole("dialog", { name: "Take payment" });
  await pay.getByLabel("Cash received").fill("90");
  await expect(pay.getByRole("button", { name: /Complete sale/ })).toBeDisabled();
  await pay.getByLabel("Cash received").fill("100");
  await expect(pay.getByTestId("change-due")).toHaveText("$1.05");
  await pay.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page).toHaveURL(/\/receipt$/);
  await expect(page.getByText("Change due $1.05")).toBeVisible();
  await expect(display.getByText("Your change: $1.05")).toBeVisible({ timeout: 10_000 });
  await display.close();

  // Void it: stock comes back
  await page.locator('input[name="reason"]').fill("Customer changed their mind at the counter");
  await page.getByRole("button", { name: "Void sale" }).click();
  await expect(page.getByText("Voided: Customer changed their mind at the counter")).toBeVisible();
  await page.goto("/inventory?q=CT-000101");
  await expect(page.getByText("96 ea").filter({ visible: true }).first()).toBeVisible();

  // Split payment: 8.00 + 0.96 + 0.60 = 9.56; $5 on debit, $10 cash for the $4.56 left
  await page.goto("/pos");
  await typeDates(page, "1975-09-02");
  await page.getByRole("button", { name: "Start sale" }).click();
  await page.getByRole("button", { name: /^Add Desert Haze 1 g Pre-roll/ }).click();
  await expect(page.getByRole("button", { name: /Pay.*\$9\.56/ })).toBeVisible();
  await page.getByRole("button", { name: /Pay/ }).click();
  await pay.getByRole("radio", { name: "Split" }).click();
  await pay.getByLabel("On the debit card").fill("5");
  await pay.getByLabel(/Cash received/).fill("10");
  await expect(pay.getByTestId("change-due")).toHaveText("$5.44");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/receipt$/);
  await expect(page.getByText("Paid by debit")).toBeVisible();
  await expect(page.getByText("Paid by cash")).toBeVisible();

  // Hold a cart, serve from the held list, then cancel it
  await page.getByRole("button", { name: "Next customer" }).click();
  await typeDates(page, "1980-02-02");
  await page.getByRole("button", { name: "Start sale" }).click();
  await page.getByRole("button", { name: /^Add Desert Haze 1 g Pre-roll/ }).click();
  await expect(qtyOf(page, "Desert Haze 1 g Pre-roll")).toHaveText("1");
  await page.keyboard.press("F4");
  await expect(page.getByRole("heading", { name: "Next customer" })).toBeVisible();
  await page.getByRole("link", { name: /^Resume S-\d{5}/ }).click();
  await expect(qtyOf(page, "Desert Haze 1 g Pre-roll")).toHaveText("1");
  await page.getByRole("button", { name: "Cancel cart" }).click();
  await page.getByRole("button", { name: "Yes, cancel cart" }).click();
  await expect(page.getByRole("heading", { name: "Next customer" })).toBeVisible();
  await expect(page.getByText("Held carts (0)")).toBeVisible();

  // Close out: float plus the $4.56 cash share of the split sale
  await page.goto("/pos/drawer");
  await expect(page.getByText("Cash that should be in the drawer").filter({ visible: true })).toBeVisible();
  await expect(page.locator("dd", { hasText: "$204.56" }).filter({ visible: true }).last()).toBeVisible();
  await page.locator('input[name="countedCash"]').fill("200");
  await page.getByRole("button", { name: "Close drawer" }).click();
  await expect(page.getByRole("heading", { name: "End-of-day report" })).toBeVisible();
  await expect(page.getByText("short by $4.56").filter({ visible: true })).toBeVisible();

  await page.goto("/pos");
  await expect(page.getByRole("button", { name: "Open drawer" })).toBeVisible();
});

test("a budtender can use the register but not change the menu or store rules", async ({ page }) => {
  await signInAtShop(page, "budtender@demo.test");
  await page.getByRole("link", { name: "Register" }).first().click();
  await expect(page.getByRole("heading", { name: "Open the drawer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Menu" })).toHaveCount(0);
  await page.goto("/pos/menu");
  await expect(page).toHaveURL(/\/dashboard/);
  // Exit returns to the rest of CannaTrace
  await page.goto("/pos");
  await page.getByRole("link", { name: "Exit" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("a manager fills the store's purchase limits from the state's rules", async ({ page }) => {
  await signInAtShop(page, "manager@demo.test");
  await page.goto("/pos/menu");
  await expect(page.getByLabel("State for purchase limits")).toHaveValue("NM");
  await page.getByRole("textbox", { name: "Flower limit per purchase, in grams" }).fill("");
  await page.getByRole("button", { name: "Fill in" }).click();
  const note = page.getByRole("status").filter({ hasText: "Filled from New Mexico adult-use law" });
  await expect(note).toBeVisible();
  await expect(note.getByRole("link", { name: /NMAC/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Flower limit per purchase, in grams" })).not.toHaveValue("");
  // Another state with a combined cap says so
  await page.getByLabel("State for purchase limits").selectOption("MI");
  await page.getByRole("button", { name: "Fill in" }).click();
  await expect(page.getByText(/Michigan also caps flower and concentrate together/)).toBeVisible();
  // Put New Mexico back and save
  await page.getByLabel("State for purchase limits").selectOption("NM");
  await page.getByRole("button", { name: "Fill in" }).click();
  await page.getByRole("button", { name: "Save store rules" }).click();
  await expect(page.getByText("Store rules saved.")).toBeVisible();
});
