import { expect, test } from "@playwright/test";

/**
 * Every time on the register is the store's local time: the clock, when the drawer opened, held carts,
 * and recent sales. Servers (Vercel, CI) run on UTC, so a time formatted without the store's zone would
 * show hours off from the clock beside it. The browser here is put in another zone on purpose, so the
 * clock can't pass by using the device's time either.
 */
test.use({ timezoneId: "Asia/Tokyo" });

const minutes = (t: string) => {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) throw new Error(`No time in "${t}"`);
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(m[2]);
};
/** The store (New Mexico) time now, as minutes since midnight. */
const storeNow = () => minutes(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Denver" }));
const close = (a: number, b: number) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b)) <= 2;

test("the register's clock, drawer, held carts, and sales all show the store's time", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("budtender@demo.test");
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
  await expect(page.getByText("Scan the barcode on the back of the ID")).toBeVisible();

  const now = storeNow();
  const header = page.locator("header", { hasText: "Customer screen" });
  await expect(header).toContainText(/Your drawer open since \d/);
  const opened = (await header.innerText()).match(/open since ([\d:]+\s*[AP]M)/i)![1];
  const clock = (await header.innerText()).match(/· (\d{1,2}:\d{2}\s*[AP]M)/i)![1];
  expect(close(minutes(clock), now), `clock ${clock}`).toBe(true);
  // Opened earlier today by the store's clock (a UTC time would look 7 hours in the future)
  expect((now - minutes(opened) + 1440) % 1440 < 12 * 60, `drawer opened ${opened}, clock ${clock}`).toBe(true);

  // Hold a cart: its time on the home screen is the store's time too
  await page.getByRole("button", { name: /Type the dates/ }).click();
  await page.getByLabel("Date of birth on the ID").fill("1980-02-02");
  await page.getByLabel("ID expiry date").fill("2031-06-30");
  await page.getByRole("button", { name: "Start sale" }).click();
  await page.getByRole("button", { name: /^Add Desert Haze 1 g Pre-roll/ }).click();
  await page.keyboard.press("F4");
  await expect(page.getByRole("heading", { name: "Next customer" })).toBeVisible();
  const held = page.getByRole("link", { name: /^Resume S-\d{5}/ }).first();
  const heldAt = (await held.innerText()).match(/(\d{1,2}:\d{2}\s*[AP]M)/i)![1];
  expect(close(minutes(heldAt), storeNow()), `held cart ${heldAt}`).toBe(true);

  // Tidy up: cancel the held cart
  await held.click();
  await page.getByRole("button", { name: "Cancel cart" }).click();
  await page.getByRole("button", { name: "Yes, cancel cart" }).click();
  await expect(page.getByRole("heading", { name: "Next customer" })).toBeVisible();

  // End of shift: count out, so the next person starts with a closed drawer
  await page.goto("/pos/drawer");
  await page.locator('input[name="countedCash"]').fill("100");
  await page.getByRole("button", { name: "Close drawer" }).click();
  await expect(page).toHaveURL(/\/pos\/drawer\/[^/]+$/);
});
