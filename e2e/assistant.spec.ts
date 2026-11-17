import { expect, test } from "@playwright/test";

test("the assistant answers from live data and only changes things after Confirm", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("inventory@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Open with the keyboard shortcut and ask a suggested question
  await page.keyboard.press("Control+j");
  const panel = page.getByRole("dialog", { name: "CannaTrace assistant" });
  await expect(panel.getByText(/what can I help with/)).toBeVisible();
  await panel.getByRole("button", { name: "Give me a quick rundown of where things stand" }).click();
  await expect(panel.getByRole("cell", { name: "Packages in stock" })).toBeVisible();

  // A seeded gummies package that sits in Vault A / Rack 2
  await page.goto("/inventory");
  const tag = "CT-000007";

  await page.getByRole("button", { name: "Ask Cousin Towel" }).first().click();
  await panel.getByLabel("Message the assistant").fill(`move ${tag} to Dry Room`);
  await panel.getByLabel("Message the assistant").press("Enter");
  const card = panel.locator("div", { hasText: "Move package" }).filter({ has: page.getByRole("button", { name: "Confirm" }) }).last();
  await expect(card.getByText(tag).first()).toBeVisible();

  // Cancel first: nothing changes
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByText("Cancelled. Nothing was changed.")).toBeVisible();

  // Ask again and confirm
  await panel.getByLabel("Message the assistant").fill(`move ${tag} to Dry Room`);
  await panel.getByLabel("Message the assistant").press("Enter");
  await panel.getByRole("button", { name: "Confirm" }).last().click();
  await expect(panel.getByText(`Moved package ${tag}.`)).toBeVisible();

  // The audit trail says it went through the assistant
  await page.keyboard.press("Escape");
  await page.goto("/audit");
  await expect(page.getByText("(via assistant)").first()).toBeVisible();
});
