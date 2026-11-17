import { expect, test } from "@playwright/test";

const run = Date.now().toString(36);
const PASSWORD = "a-long-test-password";

test("a new business signs up, builds a role, invites someone, and they join with only that role's access", async ({ page, browser }) => {
  // Sign up a brand-new business
  await page.goto("/");
  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page.getByRole("heading", { name: "Create your business account" })).toBeVisible();
  await page.locator('input[name="businessName"]').filter({ visible: true }).fill(`E2E Team Co ${run}`);
  await page.locator('input[name="facilityName"]').filter({ visible: true }).fill("Front St");
  await page.locator('input[name="licenseNumber"]').filter({ visible: true }).fill(`E2E-${run}`);
  await page.locator('select[name="licenseType"]').filter({ visible: true }).selectOption("RETAIL");
  await page.locator('input[name="state"]').filter({ visible: true }).fill("NM");
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Team Owner");
  await page.locator('input[name="email"]').filter({ visible: true }).fill(`owner-${run}@e2e.test`);
  await page.locator('input[name="password"]').filter({ visible: true }).fill(PASSWORD);
  await page.locator('input[name="confirm"]').filter({ visible: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Build a custom role from the Manager template, minus adjustments
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByRole("link", { name: "Team" }).first().click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await page.getByRole("link", { name: "Build a role" }).click();
  await page.locator('input[name="name"]').filter({ visible: true }).fill("Shift lead");
  await page.getByRole("checkbox", { name: /Use the register/ }).check();
  await page.getByRole("checkbox", { name: /See inventory/ }).check();
  await page.getByRole("checkbox", { name: /Receive, move, split/ }).check();
  await page.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByText("Shift lead").filter({ visible: true }).first()).toBeVisible();

  // Invite someone with that role and copy the link
  await page.locator('input[name="email"]').filter({ visible: true }).fill(`lead-${run}@e2e.test`);
  await page.locator('select[name="role"]').filter({ visible: true }).first().selectOption({ label: "Shift lead" });
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/invite\/[\w-]{40,}$/);
  await expect(page.getByText(`lead-${run}@e2e.test`).filter({ visible: true }).first()).toBeVisible();

  // The invited person joins in their own browser
  const theirs = await browser.newContext();
  const them = await theirs.newPage();
  await them.goto(link);
  await expect(them.getByRole("heading", { name: `Join E2E Team Co ${run}` })).toBeVisible();
  await expect(them.getByText("Shift lead")).toBeVisible();
  await them.locator('input[name="name"]').filter({ visible: true }).fill("Lee Lead");
  await them.locator('input[name="password"]').filter({ visible: true }).fill(PASSWORD);
  await them.locator('input[name="confirm"]').filter({ visible: true }).fill(PASSWORD);
  await them.getByRole("button", { name: "Join the team" }).click();
  await expect(them).toHaveURL(/\/dashboard/);
  await expect(them.getByText("Shift lead").first()).toBeVisible();
  await expect(them.getByRole("link", { name: "Register" }).first()).toBeVisible();
  await expect(them.getByRole("link", { name: "Team" })).toHaveCount(0);
  await them.goto("/team");
  await expect(them).toHaveURL(/\/dashboard/);

  // The link only works once
  await them.goto(link);
  await expect(them.getByText("This invite has already been used.")).toBeVisible();
  await theirs.close();

  // The owner switches them off, and their next page sends them to sign in
  await page.goto("/team");
  const row = page.locator("li", { hasText: `lead-${run}@e2e.test` });
  await row.getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByText("Switched off.").filter({ visible: true }).first()).toBeVisible();
});

test("the CannaTrace logo opens the homepage, which offers a way back to the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByTitle("CannaTrace home").filter({ visible: true }).first().click();
  await expect(page.getByRole("heading", { name: /From seed to sale/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await page.getByRole("link", { name: "Go to dashboard" }).first().click();
  await expect(page).toHaveURL(/\/dashboard/);
});
