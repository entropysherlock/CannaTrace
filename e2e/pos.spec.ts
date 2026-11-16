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

async function checkIn(page: Page, birthDate: string) {
  await page.goto("/pos");
  await page.locator('input[name="birthDate"]').fill(birthDate);
  await page.locator('input[name="idExpires"]').fill("2031-06-30");
  await page.getByRole("button", { name: "Start cart" }).click();
}

// Next.js keeps the previous page in the document, hidden. Only look at what is on screen.
const seen = (page: Page, text: string) => page.getByText(text).filter({ visible: true }).first();

const addItem = async (page: Page, name: string, quantity: string) => {
  const row = page.locator("li", { hasText: name }).filter({ has: page.getByRole("button", { name: "Add" }) });
  await row.getByLabel(`Quantity of ${name}`).fill(quantity);
  await row.getByRole("button", { name: "Add" }).click();
};

test("a full shift: open drawer, age check, limits, discount, cash sale, void, debit sale, close out", async ({ page }) => {
  await signInAtShop(page, "manager@demo.test");

  await page.goto("/pos");
  await page.locator('input[name="openingCash"]').fill("200");
  await page.getByRole("button", { name: "Open drawer" }).click();
  await expect(page.getByRole("heading", { name: "Check in a customer" })).toBeVisible();

  // Under 21 is refused
  const year = new Date().getFullYear();
  await checkIn(page, `${year - 20}-01-01`);
  await expect(page.locator('form p[role="alert"]')).toContainText("The minimum age is 21");

  // Adult: build a cart
  await checkIn(page, "1988-03-14");
  await expect(page.getByRole("heading", { name: /^Cart S-\d{5}$/ })).toBeVisible();
  await addItem(page, "Blue Mesa 3.5 g Jar", "17");
  await expect(page.locator('form p[role="alert"]')).toContainText("59.5 g of flower. The limit is 56.7 g per purchase");
  await addItem(page, "Blue Mesa 3.5 g Jar", "2");
  await expect(page.getByText("2 × $35.00 = $70.00")).toBeVisible();
  await addItem(page, "Prickly Pear Gummies 10-pack", "1");
  await expect(page.getByText("7 of 56.7 g")).toBeVisible();
  await expect(page.getByText("100 of 800 mg")).toBeVisible();

  await page.locator('select[name="discountId"]').selectOption({ label: "Veteran (10%)" });
  await page.getByRole("button", { name: "Apply discount" }).click();
  // 92.00 - 9.20 = 82.80; excise 12% = 9.94; sales tax 7.5% = 6.21; total 98.95
  await expect(page.getByText("-$9.20")).toBeVisible();
  await expect(page.getByText("$98.95").first()).toBeVisible();

  await page.locator('input[name="cashTendered"]').fill("90");
  await page.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page.locator('form p[role="alert"]')).toContainText("only $90.00 was handed over");
  await page.locator('input[name="cashTendered"]').fill("100");
  await page.getByRole("button", { name: /Complete sale/ }).click();

  // Receipt
  await expect(page).toHaveURL(/\/receipt$/);
  await expect(page.getByRole("button", { name: "Print receipt" })).toBeVisible();
  await expect(seen(page, "$98.95")).toBeVisible();
  await expect(seen(page, "$1.05")).toBeVisible();
  await expect(seen(page, "CT-000101")).toBeVisible();

  // Void it: the stock comes back and the sale drops out of the totals
  await page.locator('input[name="reason"]').fill("Customer changed their mind at the counter");
  await page.getByRole("button", { name: "Void sale" }).click();
  await expect(seen(page, "Voided: Customer changed their mind at the counter")).toBeVisible();
  await page.goto("/inventory?q=CT-000101");
  await expect(seen(page, "96 ea")).toBeVisible();

  // Debit sale
  await checkIn(page, "1975-09-02");
  await expect(page.getByRole("heading", { name: /^Cart S-\d{5}$/ })).toBeVisible();
  await addItem(page, "Desert Haze 1 g Pre-roll", "1");
  await expect(page.getByText("1 × $8.00 = $8.00")).toBeVisible();
  await page.locator('select[name="paymentMethod"]').selectOption("DEBIT");
  await page.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page).toHaveURL(/\/receipt$/);
  await expect(seen(page, "$9.56")).toBeVisible(); // 8.00 + 0.96 + 0.60

  // Close out: only the float should be in the drawer
  await page.goto("/pos/drawer");
  await expect(seen(page, "Cash that should be in the drawer")).toBeVisible();
  await expect(page.locator("dd", { hasText: "$200.00" }).filter({ visible: true }).last()).toBeVisible();
  await page.locator('input[name="countedCash"]').fill("195");
  await page.getByRole("button", { name: "Close drawer" }).click();
  await expect(page.getByRole("heading", { name: "End-of-day report" })).toBeVisible();
  await expect(seen(page, "short by $5.00")).toBeVisible();
  await expect(seen(page, "$9.56")).toBeVisible();
  await expect(page.getByText("voided", { exact: true }).filter({ visible: true }).first()).toBeVisible();

  await page.goto("/pos");
  await expect(page.getByRole("button", { name: "Open drawer" })).toBeVisible();
});

test("a budtender can use the register but not change the menu or store rules", async ({ page }) => {
  await signInAtShop(page, "budtender@demo.test");
  await page.getByRole("link", { name: "Register" }).first().click();
  await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Menu and store rules" })).toHaveCount(0);
  await page.goto("/pos/menu");
  await expect(page).toHaveURL(/\/dashboard/);
});
