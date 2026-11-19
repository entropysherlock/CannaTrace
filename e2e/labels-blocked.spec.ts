import { expect, test, type Page } from "@playwright/test";

const run = `LBB${Date.now().toString(36).toUpperCase()}`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function receive(page: Page, tag: string) {
  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(tag);
  await page.locator('select[name="itemId"]').selectOption({ label: "Blue Mesa Flower (bulk) (g)" });
  await page.locator('input[name="quantity"]').fill("10");
  await page.locator('select[name="locationId"]').selectOption({ label: "Dry Room" });
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: tag })).toBeVisible();
  return page.url().split("/").pop()!;
}

test("a blocked label says what to fix, links to it, and can leave out the labels that can't print", async ({ page }) => {
  await signIn(page, "inventory@demo.test");
  const good = await receive(page, `${run}-OK`);
  const empty = await receive(page, `${run}-EMPTY`);
  await page.locator("summary", { hasText: "Adjust quantity" }).click();
  await page.locator('input[name="newQuantity"]').fill("0");
  await page.locator('select[name="reasonCode"]').selectOption({ label: "Moisture loss / drying" });
  await page.getByRole("button", { name: "Save adjustment" }).click();
  await expect(page.getByText("10 → 0 g (-10)")).toBeVisible();

  // One printable package and one empty one: the empty one blocks the whole print.
  await page.goto(`/labels?kind=PACKAGE&ids=${good},${empty}`);
  await page.getByRole("button", { name: "Check and preview" }).click();
  const blocked = page.getByTestId("label-blocked-actions");
  await expect(blocked).toContainText("1 of 2 labels can't print until its record is fixed.");

  // The button is live: it brings the problems into view, each with a link to where it's fixed.
  await page.getByRole("button", { name: "Show what to fix" }).click();
  const issues = page.getByTestId("label-issues");
  await expect(issues).toBeInViewport();
  await expect(issues.getByRole("link", { name: `Open ${run}-EMPTY` }).first()).toHaveAttribute("href", `/inventory/${empty}`);

  // Leave the empty one out: the other label is checked again and can print.
  await page.getByRole("button", { name: "Leave it out and print the other 1" }).click();
  await expect(issues).toContainText("No blocking problems in 1 label");
  await expect(page.getByRole("button", { name: "Print 1 label" })).toBeEnabled();
  await expect(page.getByText("(1 chosen)")).toBeVisible();
});

test("a problem in the template itself points a manager to the template", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  await page.goto("/labels?kind=PRODUCT");
  await page.getByTestId("label-records").getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Check and preview" }).click();
  const blocked = page.getByTestId("label-blocked-actions");
  await expect(blocked).toContainText("The template has a problem that stops every label from printing.");
  await expect(blocked.getByRole("button", { name: /Leave .* out/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Show what to fix" }).click();
  const link = page.getByTestId("label-issues").getByRole("link", { name: "Fix it in the template" });
  await expect(link).toHaveAttribute("href", /\/labels\/templates\/[0-9a-f-]+$/);
});
