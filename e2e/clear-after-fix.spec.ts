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

test("a Tally Watch finding clears itself once it's fixed: no Dismiss needed", async ({ page }) => {
  await signIn(page, "inventory@demo.test", "Rio Grande Grow & Lab · DEMO-CULT-0001");
  await page.goto("/watch");
  const item = page.locator("[data-watch-item]", { hasText: /have no label printed|has no label printed/ });
  await expect(item).toBeVisible();
  // The packages the alert names before the fix
  const named = ((await item.innerText()).match(/CT-\d{6}|[A-Z0-9]+-[A-Z0-9-]+/g) ?? []).slice(0, 3);
  expect(named.length).toBeGreaterThan(0);

  await item.getByRole("button", { name: "Prepare the labels" }).click();
  const card = item.locator("[data-watch-card]");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByText(/done/i).first()).toBeVisible();

  // Next page load: Watch has looked again on its own. Those packages are no longer on the alert (it's gone
  // entirely unless other new packages are still waiting for labels), and nobody pressed Dismiss.
  await page.goto("/watch");
  const after = page.locator("[data-watch-item]", { hasText: /no label printed/ });
  if (await after.count()) for (const tag of named) await expect(after).not.toContainText(tag);
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
  await page.locator('input[name="countedCash"]').fill("100");
  await page.getByRole("button", { name: "Close drawer" }).click();
  await expect(page).toHaveURL(/\/pos\/drawer\/[^/]+$/);
});
