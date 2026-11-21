import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string, facility?: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  if (facility) {
    await page.locator('select[name="facilityId"]').selectOption({ label: facility });
    await page.getByRole("button", { name: "Switch" }).click();
    await expect(page.getByText(`${facility.split(" · ")[0]} · license`)).toBeVisible();
  }
}

test("a Tally Watch alert clears itself once it's fixed, with no Dismiss, and comes back when it changes back", async ({ page }) => {
  await signIn(page, "owner@demo.test", "Sandia Storefront · DEMO-RET-0002");
  await page.goto("/watch");
  // The state system says gummies package CT-000103 holds 58; CannaTrace says 60 (the demo amount)
  await page.getByText("Match against the state system").click();
  const csv = ["Tag,Item,Quantity,UoM,Status", "CT-000103,Gummies,58,Each,Active"].join("\n");
  await page.getByLabel("State package report (CSV)").setInputFiles({ name: "state.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Upload and compare" }).click();
  await expect(page.getByText(/Compared 1 state package/)).toBeVisible();

  await page.goto("/watch");
  const alert = () => page.locator("[data-watch-item]", { hasText: /CT-000103: CannaTrace has 60 ea, the state has 58 ea/ });
  const showAll = page.getByRole("button", { name: /^Show all \d+$/ });
  if (await showAll.isVisible()) await showAll.click();
  await expect(alert()).toBeVisible();
  const bell = page.getByTestId("top-alerts");
  const count = async () => Number(((await bell.getAttribute("aria-label")) ?? "").match(/(\d+) to look at/)?.[1] ?? 0);
  const before = await count();

  // Fix it with Tally's one-approval button
  await alert().getByRole("button", { name: "Set to 58 ea" }).click();
  const card = alert().locator("[data-watch-card]");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByText("Job done.")).toBeVisible();

  // Next page: the alert is gone and the bell counts one fewer, without anyone pressing Dismiss
  await page.goto("/watch");
  if (await showAll.isVisible()) await showAll.click();
  await expect(alert()).toHaveCount(0);
  expect(await count()).toBe(before - 1);

  // Changed back by hand on the package page: the alert comes back by itself, too
  await page.goto("/inventory?q=CT-000103");
  await page.getByRole("link", { name: /CT-000103/ }).first().click();
  await page.locator("summary", { hasText: "Adjust quantity" }).filter({ visible: true }).first().click();
  await page.locator('input[name="newQuantity"]').fill("60");
  await page.locator("form", { has: page.locator('input[name="newQuantity"]') }).locator("select").first().selectOption({ label: "Cycle count correction" });
  await page.getByRole("button", { name: "Save adjustment" }).click();
  await expect(page.getByText("Quantity adjusted and logged.")).toBeVisible();
  await page.goto("/watch");
  if (await showAll.isVisible()) await showAll.click();
  await expect(alert()).toBeVisible();

  // Leave the demo owner where the other tests expect them: signing in returns people to their last facility
  await page.locator('select[name="facilityId"]').selectOption({ label: "Rio Grande Grow & Lab · DEMO-CULT-0001" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Rio Grande Grow & Lab · license DEMO-CULT-0001")).toBeVisible();
});

test("closing the drawer isn't blocked by an empty cart nobody can see", async ({ page }) => {
  await signIn(page, "budtender@demo.test", "Sandia Storefront · DEMO-RET-0002");
  await page.goto("/pos");
  if (await page.getByRole("button", { name: "Open drawer" }).isVisible()) {
    await page.getByLabel("Starting cash").fill("100");
    await page.getByRole("button", { name: "Open drawer" }).click();
  }
  // Check an ID and start a sale, then the customer walks away before anything is added
  await page.getByRole("button", { name: /Type the dates/ }).click();
  await page.getByLabel("Date of birth on the ID").fill("1979-03-03");
  await page.getByLabel("ID expiry date").fill("2031-06-30");
  await page.getByRole("button", { name: "Start sale" }).click();
  await expect(page).toHaveURL(/\/pos\/sales\/[^/]+$/);
  await page.goto("/pos");
  await expect(page.getByRole("link", { name: /^Resume S-/ })).toHaveCount(0); // empty carts are not listed

  await page.goto("/pos/drawer");
  await page.getByRole("textbox", { name: "Cash counted in the drawer" }).fill("100");
  await page.getByRole("button", { name: "Close drawer" }).click();
  await expect(page).toHaveURL(/\/pos\/drawer\/[^/]+$/);
});
