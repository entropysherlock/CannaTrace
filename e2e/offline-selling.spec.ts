import { expect, test } from "@playwright/test";

test("the register keeps selling for cash with no internet, then sends the sale when the connection returns", async ({ page, context }) => {
  test.setTimeout(180_000);
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
  // The way in is always visible on the register, not only when the internet is down
  await expect(page.getByTestId("offline-link")).toBeVisible();
  // Online, the page prepares this device: the offline register is saved and so is a copy of the menu
  await page.waitForFunction(() => Boolean(localStorage.getItem("ct-offline-snapshot")), undefined, { timeout: 30_000 });
  await page.waitForFunction(async () => (await caches.keys()).length > 0 && Boolean(await caches.match("/pos/offline")), undefined, { timeout: 30_000 });

  // Its script files are saved too, or the page could not open with no internet
  await page.waitForFunction(async () => (await (await caches.open("ct-offline-v1")).keys()).some((r) => r.url.includes("/_next/static/") && r.url.endsWith(".js")), undefined, { timeout: 30_000 });
  // Open the offline register while online (a link, not a client-side navigation), then lose the connection
  await page.goto("/pos/offline");
  await expect(page.getByTestId("offline-banner")).toContainText("online");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByTestId("offline-banner")).toContainText("No internet");
  // (Playwright's offline mode also blocks the service worker, so that the saved page loads is checked above: it is in the cache.)

  // Bad ID is refused on the device
  await page.getByLabel("Quantity of Desert Haze 1 g Pre-roll").fill("1");
  await page.getByLabel("Date of birth").fill("2015-01-01");
  await page.getByLabel("ID expires").fill("2031-06-30");
  await page.getByLabel("Cash handed over").fill("20");
  await page.getByRole("button", { name: "Complete cash sale" }).click();
  await expect(page.getByTestId("offline-error")).toContainText(/minimum age/i);

  await page.getByLabel("Date of birth").fill("1981-04-04");
  await page.getByRole("button", { name: "Complete cash sale" }).click();
  await expect(page.getByTestId("offline-receipt")).toContainText("OFF-");
  await expect(page.getByTestId("offline-queue")).toContainText("Sales waiting to send: 1");

  // Connection returns: the sale is sent on its own
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("offline-queue")).toContainText("Sales waiting to send: 0", { timeout: 30_000 });

  // The sale is a real, completed sale on the drawer
  await page.goto("/pos");
  await expect(page.getByText(/S-\d+/).first()).toBeVisible();

  await page.goto("/pos/drawer");
  const counted = page.getByRole("textbox", { name: "Cash counted in the drawer" });
  if (await counted.isVisible()) {
    await counted.fill("100");
    await page.getByRole("button", { name: "Close drawer" }).click();
  }
});
