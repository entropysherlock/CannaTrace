import { expect, test, type Page } from "@playwright/test";

const run = Date.now().toString(36);
const PASSWORD = "a-long-test-password";
const BUSINESS = `Support Test Co ${run}`;

async function signIn(page: Page, email: string, password = "demo1234") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("CannaTrace support opens a customer's account, sees it as they do, and every visit is logged", async ({ page, browser }) => {
  // A customer signs up
  const customer = await browser.newPage();
  await customer.goto("/signup");
  await customer.locator('input[name="businessName"]').filter({ visible: true }).fill(BUSINESS);
  await customer.locator('input[name="facilityName"]').filter({ visible: true }).fill("Canyon Road Store");
  await customer.locator('input[name="licenseNumber"]').filter({ visible: true }).fill(`SUP-${run}`);
  await customer.locator('select[name="licenseType"]').filter({ visible: true }).selectOption("RETAIL");
  await customer.locator('select[name="state"]').filter({ visible: true }).selectOption("NM");
  await customer.locator('input[name="ownerName"]').filter({ visible: true }).fill("Casey Customer");
  await customer.locator('input[name="email"]').filter({ visible: true }).fill(`casey-${run}@e2e.test`);
  await customer.locator('input[name="password"]').filter({ visible: true }).fill(PASSWORD);
  await customer.locator('input[name="confirm"]').filter({ visible: true }).fill(PASSWORD);
  await customer.getByRole("button", { name: "Create my account" }).click();
  await expect(customer).toHaveURL(/\/dashboard/);

  // Support (the local demo owner is a support admin) finds the business
  await signIn(page, "owner@demo.test");
  await page.getByRole("link", { name: "Support Console" }).first().click();
  await expect(page.getByRole("heading", { name: "Support Console" })).toBeVisible();
  // Found by the license number of one of its facilities, which is listed on its own line
  await page.getByLabel("Search businesses").fill(`sup-${run}`);
  await page.getByRole("button", { name: "Search" }).click();
  const facility = page.getByRole("list", { name: `Facilities of ${BUSINESS}` }).getByRole("listitem").filter({ hasText: "Canyon Road Store" });
  await expect(facility).toContainText(`New Mexico · retail · license SUP-${run.toUpperCase()}`);

  // A reason is required, then that facility opens
  await facility.getByRole("button", { name: "Open" }).click();
  await expect(facility.getByLabel("Reason for opening Canyon Road Store")).toBeFocused();
  await facility.getByLabel("Reason for opening Canyon Road Store").fill("Helping set up their first facility");
  await facility.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const banner = page.getByRole("note", { name: "Support view" });
  await expect(banner).toContainText(`you are inside ${BUSINESS} as CannaTrace support`);
  await expect(page.getByText("Canyon Road Store · license")).toBeVisible();
  await expect(page.getByRole("link", { name: "Support Console" })).toHaveCount(0);

  // Support can act with owner access; it is recorded under support's name
  await page.goto("/settings/facilities");
  await expect(page.getByRole("heading", { name: "Facilities" })).toBeVisible();
  await page.goto("/audit");
  await expect(page.getByRole("region", { name: "Audit trail entries" }).getByText("Olivia Owner (CannaTrace support)").first()).toBeVisible();
  await expect(page.getByText("Helping set up their first facility").first()).toBeVisible();

  // Leave: back in support's own account and console
  await banner.getByRole("button", { name: "Exit support view" }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByRole("note", { name: "Support view" })).toHaveCount(0);
  await expect(page.locator("li", { hasText: BUSINESS }).filter({ hasText: "opened by Olivia Owner" })).toContainText("Helping set up their first facility");
  await expect(page.locator("li", { hasText: BUSINESS }).filter({ hasText: "left by Olivia Owner" })).toBeVisible();

  // The customer sees the visit in their own audit trail
  await customer.goto("/audit");
  await expect(customer.getByRole("region", { name: "Audit trail entries" }).getByText("Olivia Owner (CannaTrace support)").first()).toBeVisible();
  await customer.close();
});

test("people who are not CannaTrace support cannot reach the console", async ({ page }) => {
  await signIn(page, "manager@demo.test");
  await expect(page.getByRole("link", { name: "Support Console" })).toHaveCount(0);
  await page.goto("/support");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("support sets up a new business for a customer, and the owner joins from the invite link", async ({ page, browser }) => {
  const company = `Mesa Verde Cannabis ${run}`;
  await signIn(page, "owner@demo.test");
  await page.goto("/support");
  const form = page.locator("details", { hasText: "Set up a new business" });
  if (!(await form.evaluate((d) => (d as HTMLDetailsElement).open))) await form.getByText("Show").click();
  await form.getByRole("textbox", { name: "Business (company) name" }).fill(company);
  await form.getByRole("textbox", { name: "First facility name" }).fill("Durango Ave");
  await form.getByRole("textbox", { name: "State license number" }).fill(`MV-${run}`);
  await form.getByRole("combobox", { name: "License type" }).selectOption("RETAIL");
  await form.locator('select[name="state"]').selectOption("CO");
  await form.getByRole("textbox", { name: "Owner's email" }).fill(`mesa-${run}@e2e.test`);
  await form.getByRole("button", { name: "Create business" }).click();
  const done = form.getByRole("status");
  await expect(done).toContainText(`Created ${company}.`);
  const link = (await done.innerText()).match(/https?:\/\/\S+\/invite\/\S+/)![0];

  // It is listed with its facility and can be opened before the owner joins
  const row = page.getByRole("list", { name: `Facilities of ${company}` }).getByRole("listitem");
  await expect(row).toContainText(`Colorado · retail · license MV-${run.toUpperCase()}`);

  // The owner sets their password and lands in their new business
  const owner = await browser.newPage();
  await owner.goto(new URL(link).pathname);
  await expect(owner.getByRole("heading", { name: `Join ${company}` })).toBeVisible();
  await owner.locator('input[name="name"]').filter({ visible: true }).fill("Morgan Mesa");
  await owner.locator('input[name="password"]').filter({ visible: true }).fill(PASSWORD);
  await owner.locator('input[name="confirm"]').filter({ visible: true }).fill(PASSWORD);
  await owner.getByRole("button", { name: "Join the team" }).click();
  await expect(owner).toHaveURL(/\/dashboard/);
  await expect(owner.getByText("Durango Ave · license")).toBeVisible();
  await owner.close();
});
