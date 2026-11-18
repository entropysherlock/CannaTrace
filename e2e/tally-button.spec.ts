import { expect, test } from "@playwright/test";

// Tally's floating button is on every tab. Only the Command Center hides it on wide screens, where Tally is docked beside the cards.
test("Tally's floating button is on every tab, even after visiting the Command Center", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  const launcher = page.getByTestId("tally-launcher");
  await expect(launcher).toBeHidden();

  const nav = page.getByRole("navigation").filter({ visible: true }).first();
  for (const tab of ["Inventory", "Cultivation", "Reports", "Compliance", "Tally Watch", "Settings"]) {
    await nav.getByRole("link", { name: tab, exact: true }).click();
    await expect(page).not.toHaveURL(/dashboard/);
    await expect(launcher, `Tally's button on ${tab}`).toBeVisible();
    const b = (await launcher.boundingBox())!;
    expect(1600 - (b.x + b.width)).toBeGreaterThanOrEqual(16);
    expect(1000 - (b.y + b.height)).toBeGreaterThanOrEqual(16);
    // Other tabs keep their usual width
    expect((await page.getByTestId("page-column").boundingBox())!.width).toBeLessThanOrEqual(1152);
  }
  // Back on the Command Center it's docked again, and the button opens the panel everywhere else
  await nav.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(launcher).toBeHidden();
  await nav.getByRole("link", { name: "Inventory", exact: true }).click();
  await launcher.click();
  await expect(page.getByRole("dialog", { name: "CannaTrace assistant" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(launcher).toBeVisible();
});
