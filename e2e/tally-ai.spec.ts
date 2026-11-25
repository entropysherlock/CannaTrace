import { expect, test, type Page } from "@playwright/test";

// The test server runs with ASSISTANT_FAKE=1: no real Claude calls. Keys containing "bad" or
// "nocredit" are refused the way Anthropic would refuse them; other well-formed keys are accepted.
const GOOD = `sk-ant-api03-test-good-${"x".repeat(30)}Q7wZ`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("an owner connects the business's Claude account, sets limits, and the team shares it", async ({ page, browser }) => {
  await signIn(page, "owner@demo.test");
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByRole("link", { name: "Tally AI" }).click();
  await expect(page.getByRole("heading", { name: "Tally AI" })).toBeVisible();
  await expect(page.getByText("Not connected")).toBeVisible();
  await expect(page.getByRole("link", { name: /Go to API keys/ })).toHaveAttribute("href", "https://platform.claude.com/settings/keys");
  await expect(page.getByRole("link", { name: /Go to Billing/ })).toHaveAttribute("href", "https://platform.claude.com/settings/billing");

  // Refused keys are explained and not saved
  const keyBox = page.getByLabel("Claude API key");
  await keyBox.fill("hello");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "doesn't look like a Claude API key" })).toBeVisible();
  await keyBox.fill(`sk-ant-api03-test-nocredit-${"x".repeat(30)}`);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "out of credits" })).toBeVisible();

  // A working key connects; only its last four characters are ever shown
  await keyBox.fill(GOOD);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected. Tally now runs on your Claude account (key sk-ant-…Q7wZ)")).toBeVisible();
  await expect(page.getByTestId("key-hint")).toHaveText("sk-ant-…Q7wZ");
  expect(await page.content()).not.toContain(GOOD);

  // Pick a model and a tight per-person limit
  await page.getByRole("radio", { name: /Claude Haiku 5.5/ }).check();
  await page.getByRole("button", { name: "Save model" }).click();
  await expect(page.getByText("Model saved.")).toBeVisible();
  await page.getByRole("textbox", { name: "Questions per person per day" }).fill("1");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Limits saved.")).toBeVisible();

  // A team member uses the shared connection, then hits the per-person limit
  const team = await browser.newPage();
  await signIn(team, "sales@demo.test");
  await team.keyboard.press("Control+j");
  const panel = team.getByRole("dialog", { name: "Leaf2Sale assistant" });
  await panel.getByRole("button", { name: "Give me a quick rundown of where things stand" }).click();
  await expect(panel.getByRole("cell", { name: "Packages in stock" })).toBeVisible();
  await panel.getByLabel("Message the assistant").fill("and again?");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByText(/Tally questions? per person in 24 hours/)).toBeVisible();

  // Usage shows up for the owner
  await page.reload();
  await expect(page.locator("li", { hasText: "Sam Sales" }).first()).toBeVisible();

  // Pausing turns Tally off for the team without removing the key
  await page.getByRole("textbox", { name: "Questions per person per day" }).fill("60");
  await page.getByLabel("Tally is on for the team").uncheck();
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Limits saved.")).toBeVisible();
  await team.reload();
  await team.waitForTimeout(500);
  if (!(await panel.isVisible())) await team.keyboard.press("Control+j");
  await expect(panel.getByText("Tally is paused")).toBeVisible();

  // Disconnect needs a typed confirmation
  await page.locator("summary", { hasText: "Disconnect" }).click();
  await page.getByRole("textbox", { name: 'Type "disconnect" to confirm' }).fill("disconnect");
  await page.getByRole("button", { name: "Disconnect Tally" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();
  await team.close();
});

test("managers cannot open the Tally AI connection settings", async ({ page }) => {
  await signIn(page, "manager@demo.test");
  await expect(page.getByRole("link", { name: "Tally AI" })).toHaveCount(0);
  await page.goto("/settings/ai");
  await expect(page).toHaveURL(/\/dashboard/);
});
