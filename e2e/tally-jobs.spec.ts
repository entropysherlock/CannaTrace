import { expect, test } from "@playwright/test";

test("Tally plans a receiving from plain English, runs it after one Confirm, and Undo reverses it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("inventory@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  const tag = `E2E-${Date.now().toString(36).toUpperCase()}`;
  await page.keyboard.press("Control+j");
  const panel = page.getByRole("dialog", { name: "Leaf2Sale assistant" });
  await panel.getByLabel("Message the assistant").fill(`receive ${tag} of gummies into Vault A`);
  await panel.getByLabel("Message the assistant").press("Enter");

  // The card shows the whole plan before anything happens
  await expect(panel.locator("[data-plan-steps] li").first()).toContainText(tag);
  await panel.getByRole("button", { name: "Confirm" }).last().click();
  await expect(panel.getByText("Received 1 package.")).toBeVisible();

  // One click undoes it
  await panel.getByRole("button", { name: "Undo this" }).click();
  await expect(panel.getByText(/Undone: Receive 1 package/)).toBeVisible();

  // The audit trail keeps both, and lists the Tally change as undone
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Changes made through Tally" })).toBeVisible();
  await expect(page.getByText(/Undone by .*undo via assistant/).first()).toBeVisible();
});
