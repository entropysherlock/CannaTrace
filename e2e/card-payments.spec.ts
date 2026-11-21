import { expect, test } from "@playwright/test";

test("a card payment is recorded with its last 4 digits and approval number, and shows on the receipt and the end-of-day report", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();

  await page.goto("/pos");
  if (await page.getByRole("button", { name: "Open drawer" }).isVisible()) {
    await page.getByLabel("Starting cash").fill("100");
    await page.getByRole("button", { name: "Open drawer" }).click();
  }
  await page.getByRole("button", { name: /Type the dates/ }).click();
  await page.getByLabel("Date of birth on the ID").fill("1981-04-04");
  await page.getByLabel("ID expiry date").fill("2031-06-30");
  await page.getByRole("button", { name: "Start sale" }).click();
  await page.getByRole("button", { name: /^Add Desert Haze 1 g Pre-roll/ }).click();
  await page.getByRole("button", { name: /Pay/ }).click();
  const pay = page.getByRole("dialog", { name: /Take payment/ });

  // Cash needs no card details; debit says plainly that CannaTrace does not charge the card
  await expect(pay.getByTestId("card-details")).toHaveCount(0);
  await pay.getByRole("radio", { name: "Debit" }).click();
  const details = pay.getByTestId("card-details");
  await expect(details).toContainText("does not charge the card");
  await details.getByLabel("Last 4 digits").fill("4242abc"); // letters are ignored, and only 4 digits fit
  await expect(details.getByLabel("Last 4 digits")).toHaveValue("4242");
  await details.getByLabel("Approval number").fill("AP-7731");
  await pay.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page).toHaveURL(/\/receipt$/);
  await expect(page.getByTestId("card-note")).toHaveText("Card ending 4242 · approval AP-7731");

  // Count out the drawer and read the report
  await page.goto("/pos/drawer");
  const counted = page.getByLabel("Cash counted in the drawer");
  if (await counted.isVisible()) {
    await counted.fill("100");
    await page.getByRole("button", { name: "Close drawer" }).click();
  }
  await expect(page).toHaveURL(/\/pos\/drawer\/[^/]+$/);
  const report = page.getByTestId("card-payments");
  await expect(report).toContainText("ending 4242");
  await expect(report).toContainText("AP-7731");
  await expect(report).toContainText("not charged by CannaTrace");

  // Leave things as the other tests expect: manager back at the grow
  await page.goto("/dashboard");
  await page.locator('select[name="facilityId"]').selectOption({ label: "Rio Grande Grow & Lab · DEMO-CULT-0001" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Rio Grande Grow & Lab · license DEMO-CULT-0001")).toBeVisible();
});
