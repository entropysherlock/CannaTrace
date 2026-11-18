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
  for (const kpi of ["plants", "active-packages", "open-wholesale-orders", "sales-today", "pending-reports", "alerts"]) await expect(page.getByTestId(`kpi-${kpi}`)).toBeVisible();
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
