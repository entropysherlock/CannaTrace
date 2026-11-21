import { expect, test, type Page } from "@playwright/test";

/**
 * Rewards at the register, the way a budtender uses it: turn the program on, sign a shopper up at the counter
 * (only once they agree), earn on the sale, then spend a reward as dollars off on the next visit.
 */
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

/** Use the drawer if it's already open (another test, or a run that stopped part-way); otherwise open one. */
async function openDrawer(page: Page) {
  await page.goto("/pos");
  const open = page.getByRole("button", { name: "Open drawer" });
  const home = page.getByRole("heading", { name: "Next customer" });
  await expect(open.or(home)).toBeVisible();
  if (await home.isVisible()) return;
  await page.getByLabel("Starting cash").fill("200");
  await page.getByRole("button", { name: "Open drawer" }).click();
  await expect(home).toBeVisible();
}

async function startSale(page: Page, birth: string) {
  await page.getByRole("button", { name: /Type the dates/ }).click();
  await page.getByLabel("Date of birth on the ID").fill(birth);
  await page.getByLabel("ID expiry date").fill("2031-06-30");
  await page.getByRole("button", { name: "Start sale" }).click();
  await expect(page.getByRole("heading", { name: /^Cart S-\d{5}$/ })).toBeVisible();
}

async function payCash(page: Page) {
  await page.getByRole("button", { name: /Pay/ }).click();
  const pay = page.getByRole("dialog", { name: "Take payment" });
  await pay.getByLabel("Cash received").fill("500");
  await pay.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page).toHaveURL(/\/receipt$/);
}

test("rewards: sign up at the counter, earn on a sale, spend a reward on the next visit", async ({ page }) => {
  test.setTimeout(180_000);
  const phone = `505${String(Date.now()).slice(-7).replace(/^[01]/, "7")}`;
  await signInAtShop(page, "manager@demo.test");

  // Turn the program on with the industry-standard numbers
  await page.goto("/pos/rewards");
  await page.getByRole("checkbox", { name: /Rewards are on/ }).check();
  await page.getByRole("button", { name: "Save rewards settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rewards are on: 1 point per $1, 100 points = $5.00 off (5% back)" })).toBeVisible();

  // First visit: sign up only once they agree
  await openDrawer(page);
  await startSale(page, "1985-04-04");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^Add Blue Mesa 3.5 g Jar/ }).click();
  const rewards = page.getByRole("region", { name: "Rewards" });
  await rewards.getByLabel("Shopper's phone number").fill(phone);
  await rewards.getByRole("button", { name: "Find" }).click();
  await expect(rewards.getByText("No rewards account for that number. Sign them up?")).toBeVisible();
  await rewards.getByRole("textbox", { name: "First name" }).fill("Riley");
  await expect(rewards.getByRole("button", { name: "Sign up" })).toBeDisabled();
  await rewards.getByRole("checkbox", { name: /agreed to join rewards/ }).check();
  await rewards.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Riley joined rewards with 25 welcome points" })).toBeVisible();
  await expect(rewards.getByText("25 pts")).toBeVisible();
  await expect(rewards.getByText(/75 more points to a \$5 reward/)).toBeVisible();
  await payCash(page);
  await expect(page.getByTestId("receipt-rewards").filter({ visible: true })).toContainText(/Riley earned \d+ points/);

  // Second visit: find them by phone and spend a reward
  await page.getByRole("button", { name: "Next customer" }).click();
  await startSale(page, "1985-04-04");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^Add Blue Mesa 3.5 g Jar/ }).click();
  await rewards.getByLabel("Shopper's phone number").fill(phone);
  await rewards.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Riley has \d+ points/ })).toBeVisible();
  await rewards.getByRole("radio", { name: "$5 off (100 pts)" }).click();
  await expect(page.getByRole("complementary", { name: "Cart" }).getByText("Rewards (100 pts)")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Cart" }).getByText("-$5.00")).toBeVisible();
  await payCash(page);
  await expect(page.getByTestId("receipt-rewards").filter({ visible: true })).toContainText("used $5.00 off");

  // The manager sees the shopper and every points change
  await page.goto(`/pos/rewards?q=${phone.slice(-4)}`);
  await page.getByRole("link", { name: /Riley/ }).first().click();
  const history = page.getByTestId("reward-history");
  await expect(history.getByText("Welcome bonus", { exact: true })).toBeVisible();
  await expect(history.getByText("Used", { exact: true })).toBeVisible();
  await expect(history.getByText("Earned", { exact: true }).first()).toBeVisible();
});
