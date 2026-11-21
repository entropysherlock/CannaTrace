import { expect, test } from "@playwright/test";

const run = Date.now().toString(36);
const slug = `menu-${run}`;
const phone = `505${String(Date.now()).slice(-7)}`;

test("a manager turns on the menu, a visitor reserves, and staff turn it into a sale", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();

  // Turn the public menu on
  await page.goto("/pos/menu");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Online menu and pickups" }) });
  await card.getByLabel("Show a public menu for this store").check();
  await card.locator('input[name="slug"]').fill(slug);
  await card.locator('textarea[name="pickupNote"]').fill("Park in the back lot.");
  await card.getByRole("button", { name: "Save online menu" }).click();
  await expect(card.getByText("Online menu saved. It is live.")).toBeVisible();

  // A visitor who is not signed in
  const visitor = await browser.newContext({ baseURL });
  const v = await visitor.newPage();
  await v.goto(`/menu/${slug}`);
  await expect(v.getByTestId("age-gate")).toBeVisible();
  await expect(v.getByTestId("menu-item")).toHaveCount(0); // nothing is shown before the age check
  await v.getByRole("button", { name: /Yes, I'm 21 or older/ }).click();
  await expect(v.getByTestId("menu-item").first()).toBeVisible();
  await expect(v.locator("body")).not.toContainText(/in stock|on hand/i);
  const first = v.getByTestId("menu-item").first();
  await first.getByRole("button", { name: /^More / }).click();
  await v.getByLabel("Your name").fill("Pat Visitor");
  await v.getByLabel("Phone").fill(phone);
  await v.getByRole("button", { name: "Reserve for pickup" }).click();
  await expect(v.getByText("Please confirm you are 21 or older.")).toBeVisible(); // the box is not checked yet
  await v.getByLabel(/I am 21 or older/).check();
  await v.getByRole("button", { name: "Reserve for pickup" }).click();
  await expect(v.getByTestId("reservation-confirmation")).toBeVisible();
  await expect(v.getByRole("heading", { name: /^Reservation PU-\d{5}$/ })).toBeVisible();
  await expect(v.getByText("Park in the back lot.")).toBeVisible();
  await visitor.close();

  // Staff see it
  await page.goto("/pos");
  let openedDrawer = false;
  if (await page.getByRole("button", { name: "Open drawer" }).isVisible()) {
    await page.getByLabel("Starting cash").fill("100");
    await page.getByRole("button", { name: "Open drawer" }).click();
    openedDrawer = true;
  }
  await expect(page.getByTestId("pickups-banner")).toBeVisible();
  await page.goto("/pos/pickups");
  const row = page.getByTestId("pickup-row").filter({ hasText: "Pat Visitor" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Mark ready" }).click();
  await expect(row.getByText(/Ready for pickup/)).toBeVisible();

  // The customer arrives: ID check and a cart with the reserved item
  await row.getByText("Customer is here: check ID and start the sale").click();
  await row.locator('input[name="birthDate"]').fill("1985-02-02");
  await row.locator('input[name="idExpires"]').fill("2032-06-30");
  await row.getByRole("button", { name: "Check ID and open the cart" }).click();
  await expect(page.getByRole("heading", { name: /^Cart S-\d{5}$/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Cart" }).getByTestId("line-qty")).toHaveText("1");

  // Put things back the way the other tests expect: no open cart, the drawer this test opened counted out,
  // and the manager at the grow.
  await page.getByRole("button", { name: "Cancel cart" }).click();
  await page.getByRole("button", { name: "Yes, cancel cart" }).click();
  if (openedDrawer) {
    await page.goto("/pos/drawer");
    await page.getByRole("textbox", { name: "Cash counted in the drawer" }).fill("100");
    await page.getByRole("button", { name: "Close drawer" }).click();
    await expect(page).toHaveURL(/\/pos\/drawer\/[^/]+$/);
  }
  await page.goto("/dashboard");
  await page.locator('select[name="facilityId"]').selectOption({ label: "Rio Grande Grow & Lab · DEMO-CULT-0001" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Rio Grande Grow & Lab · license DEMO-CULT-0001")).toBeVisible();
});
