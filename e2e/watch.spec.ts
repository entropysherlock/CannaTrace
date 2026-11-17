import { expect, test } from "@playwright/test";

test("Tally Watch matches against a state report, fixes a difference after one Confirm, and Undo reverses it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.getByRole("link", { name: "Tally Watch" }).first().click();
  await expect(page.getByRole("heading", { name: "Tally Watch" })).toBeVisible();

  // Upload a state report where one package's count differs and one package exists only in the state system
  const only = `1A4E2E${Date.now().toString(36).toUpperCase()}`;
  const csv = ["Tag,Item,Quantity,UoM,Status", "CT-000008,Gummies,1990,Each,Active", `${only},Mystery,3,Each,Active`].join("\n");
  await page.getByLabel("State package report (CSV)").setInputFiles({ name: "metrc-packages.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Upload and compare" }).click();
  await expect(page.getByText(/Compared 2 state packages with CannaTrace/)).toBeVisible();
  await expect(page.getByText(`Package ${only} is open in the state system but not in CannaTrace`)).toBeVisible();

  const item = page.locator("[data-watch-item]", { hasText: /CT-000008: CannaTrace has .* the state has 1,990 ea/ });
  await item.getByRole("button", { name: "Set to 1,990 ea" }).click();
  const card = item.locator("[data-watch-card]");
  await expect(card.getByText(/Set CT-000008 from .* to 1,990 ea \(Cycle count correction\)/)).toBeVisible();
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByText("Job done.")).toBeVisible();

  await card.getByRole("button", { name: "Undo this" }).click();
  await expect(card.getByText(/Undone: Match CT-000008 to the state/)).toBeVisible();

  // The dashboard points to Tally Watch
  await page.goto("/dashboard");
  await expect(page.locator("[data-watch-summary]")).toContainText("Tally Watch found");
});
