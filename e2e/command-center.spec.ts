import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email = "owner@demo.test") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("the Command Center shows the business at a glance, for one facility or all, over 7, 30, or 90 days", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  for (const kpi of ["plants", "packages-in-stock", "open-wholesale-orders", "sales-today", "pending-reports", "alerts"]) await expect(page.getByTestId(`kpi-${kpi}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations flow" })).toBeVisible();
  await expect(page.getByTestId("inventory-health")).toContainText("Available");
  await expect(page.getByRole("heading", { name: "Production throughput" })).toBeVisible();
  await expect(page.getByTestId("facility-list")).toContainText("You're here");
  await expect(page.getByTestId("compliance-status")).toContainText("Audit trail");
  await expect(page.getByTestId("tally-dock")).toContainText("here's your operations summary");

  // The menu: Operations, Tools, Intelligence, Admin
  const nav = page.getByRole("navigation").filter({ visible: true }).first();
  for (const heading of ["Operations", "Tools", "Intelligence", "Admin"]) await expect(nav.getByText(heading, { exact: true })).toBeVisible();
  for (const link of ["Tally Watch", "Walkthroughs", "SmartLabel AI", "Settings"]) await expect(nav.getByRole("link", { name: link })).toBeVisible();

  // All facilities, then the last 7 days
  await page.getByTestId("dash-scope").selectOption("all");
  await expect(page).toHaveURL(/scope=all/);
  await page.getByTestId("dash-days").selectOption("7");
  await expect(page).toHaveURL(/scope=all&days=7/);
  await expect(page.getByRole("heading", { name: "Sales trend" })).toBeVisible();
  await expect(page.getByText("Retail and wholesale, last 7 days")).toBeVisible();

  // A suggested question opens Tally already asking it
  await page.getByTestId("tally-dock").getByRole("button", { name: "What's running low in inventory?" }).click();
  await expect(page.getByRole("dialog", { name: "CannaTrace assistant" })).toBeVisible();
});

test("the top bar searches the business, rings the Tally Watch bell, and opens walkthroughs", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Search CannaTrace").fill("CT-0000");
  await page.getByLabel("Search CannaTrace").press("Enter");
  await expect(page).toHaveURL(/\/search\?q=CT-0000/);
  await expect(page.getByTestId("search-results")).toContainText("Packages");

  await page.getByTestId("top-alerts").click();
  await expect(page).toHaveURL(/\/watch$/);

  await page.getByRole("link", { name: "Help and walkthroughs" }).click();
  await expect(page.getByRole("heading", { name: "Walkthroughs" })).toBeVisible();
  await page.getByTestId("start-receive-delivery").click();
  await expect(page).toHaveURL(/\/inventory\/receive$/);
  await expect(page.getByTestId("walk-bubble")).toContainText("Scan the tag");
  await page.keyboard.press("Escape");

  // The account menu has sign out
  await page.getByLabel("Your account").click();
  await expect(page.getByRole("link", { name: "Change password" })).toBeVisible();
});

test("Tally Watch on the Command Center is grouped by cause, and each group opens with every alert in it", async ({ page }) => {
  await signIn(page);
  const groups = page.getByTestId("watch-group");
  await expect(groups.first()).toBeVisible();
  // The KPI, the donut and Tally's summary count the same packages
  const inStock = (await page.getByTestId("kpi-packages-in-stock").getByTestId("kpi-value").innerText()).trim();
  await expect(page.getByTestId("inventory-health")).toContainText(inStock);
  await expect(page.getByTestId("tally-dock")).toContainText(`of ${inStock} packages in stock`);

  const label = (await groups.first().locator("span.font-semibold").first().innerText()).trim();
  const count = Number((await groups.first().getByTestId("group-count").innerText()).trim());
  await groups.first().click();
  await expect(page).toHaveURL(/\/watch#/);
  const key = new URL(page.url()).hash.slice(1);
  const section = page.locator(`section[id="${key}"]`);
  await expect(section.getByRole("heading")).toContainText(label);
  // Linked straight to it, the group shows every alert, not just the first few
  await expect(section.locator("[data-watch-item]")).toHaveCount(count);
  await expect(page.getByTestId("watch-groups")).toContainText(label);
});

test("Tally's floating button sits bottom-right, clear of the dock, and the panel opens and closes cleanly", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signIn(page);
  const launcher = page.getByTestId("tally-launcher");
  await expect(launcher).toBeVisible();
  const b = (await launcher.boundingBox())!;
  expect(1600 - (b.x + b.width)).toBeGreaterThanOrEqual(16);
  expect(1000 - (b.y + b.height)).toBeGreaterThanOrEqual(16);
  const d = (await page.getByTestId("tally-dock").boundingBox())!;
  expect(d.x + d.width).toBeLessThanOrEqual(b.x);

  // Open with the button, close with Escape: focus goes back to the button and the page still scrolls
  const dialog = page.getByRole("dialog", { name: "CannaTrace assistant" });
  await launcher.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // A dock question opens it once, without flicker, and the close button closes it
  await page.getByTestId("tally-dock").getByRole("button", { name: "Give me today's sales" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close assistant" }).click();
  await expect(dialog).toBeHidden();
});

test("on a phone, Tally's button stays above the tab bar and the open panel holds the page still", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const launcher = page.getByTestId("tally-launcher");
  const b = (await launcher.boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "Quick" }).boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(nav.y);
  expect(390 - (b.x + b.width)).toBeGreaterThanOrEqual(12);
  await launcher.click();
  await expect(page.getByRole("dialog", { name: "CannaTrace assistant" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe("");
});
