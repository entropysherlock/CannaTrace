import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string, password = "demo1234") {
  await page.goto("/login");
  await page.getByLabel("Email").filter({ visible: true }).fill(email);
  await page.getByLabel("Password").filter({ visible: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("signing out one account never signs out another; joining in a signed-in browser warns first", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, "owner@demo.test");

  // Owner invites a budtender
  await owner.goto("/team");
  const email = `bud-${Date.now().toString(36)}@e2e.test`;
  await owner.locator('input[name="email"]').filter({ visible: true }).fill(email);
  await owner.locator('select[name="role"]').filter({ visible: true }).first().selectOption({ label: "Budtender" });
  await owner.getByRole("button", { name: "Create invite link" }).click();
  const link = await owner.getByLabel("Invite link").inputValue();

  // Opened in the owner's own browser: a warning that joining here signs the owner out
  await owner.goto(link);
  await expect(owner.getByTestId("signed-in-note")).toContainText("is signed in on this browser");

  // The budtender joins in their own browser: no warning there
  const bud = await (await browser.newContext()).newPage();
  await bud.goto(link);
  await expect(bud.getByTestId("signed-in-note")).toHaveCount(0);
  await bud.locator('input[name="name"]').fill("Sam Budtender");
  await bud.locator('input[name="password"]').fill("a-long-password-1");
  await bud.locator('input[name="confirm"]').fill("a-long-password-1");
  await bud.keyboard.press("Enter");
  await expect(bud).toHaveURL(/\/dashboard/);

  // The budtender signs out: the owner, in another browser, stays signed in
  await bud.locator("summary[aria-label=\"Your account\"]").filter({ visible: true }).first().click();
  await bud.getByRole("button", { name: "Sign out" }).filter({ visible: true }).first().click();
  await expect(bud).toHaveURL(/\/login/);
  await owner.goto("/team");
  await expect(owner).toHaveURL(/\/team$/);
  await expect(owner.getByText(email).filter({ visible: true }).first()).toBeVisible();
});
