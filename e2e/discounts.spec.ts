import { expect, test } from "@playwright/test";

test("a manager removes a discount, and the register no longer offers it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();

  const name = `Industry ${Date.now().toString(36).slice(-4)}`;
  await page.goto("/pos/menu");
  const add = page.locator("section", { has: page.getByRole("heading", { name: "Add a discount" }) });
  await add.locator('input[name="name"]').fill(name);
  await add.locator('input[name="percent"]').fill("20");
  await add.getByRole("button", { name: "Add discount" }).click();
  await expect(add.getByText(`Added ${name}.`)).toBeVisible();
  const list = page.locator("section", { has: page.getByRole("heading", { name: "Discounts", exact: true }) });
  await expect(list.getByText(name, { exact: true })).toBeVisible();

  // The register offers it
  await page.goto("/pos");
  let openedDrawer = false;
  if (await page.getByRole("button", { name: "Open drawer" }).isVisible()) {
    await page.getByLabel("Starting cash").fill("100");
    await page.getByRole("button", { name: "Open drawer" }).click();
    openedDrawer = true;
  }
  await page.getByRole("button", { name: /Type the dates/ }).click();
  await page.getByLabel("Date of birth on the ID").fill("1981-04-04");
  await page.getByLabel("ID expiry date").fill("2031-06-30");
  await page.getByRole("button", { name: "Start sale" }).click();
  await page.getByRole("button", { name: /^Add Desert Haze 1 g Pre-roll/ }).click();
  const choices = page.getByRole("radiogroup", { name: "Discount" });
  await expect(choices.getByRole("radio", { name: new RegExp(name) })).toBeVisible();
  const cart = page.url();

  // Remove it from the store's list
  await page.goto("/pos/menu");
  await list.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(list.getByText(name, { exact: true })).toHaveCount(0);

  // The register no longer offers it
  await page.goto(cart);
  await expect(page.getByRole("radiogroup", { name: "Discount" }).getByRole("radio", { name: new RegExp(name) })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel cart" }).click();
  await page.getByRole("button", { name: "Yes, cancel cart" }).click();

  // Count out the drawer this test opened, so the next test starts the way it expects
  if (openedDrawer) {
    await page.goto("/pos/drawer");
    await page.getByLabel("Cash counted in the drawer").fill("100");
    await page.getByRole("button", { name: "Close drawer" }).click();
    await expect(page).toHaveURL(/\/pos\/drawer\/[^/]+$/);
  }

  // Leave the demo manager at the grow, where the other tests expect them (sign-in returns people to their last facility)
  await page.goto("/dashboard");
  await page.locator('select[name="facilityId"]').selectOption({ label: "Rio Grande Grow & Lab · DEMO-CULT-0001" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Rio Grande Grow & Lab · license DEMO-CULT-0001")).toBeVisible();
});
