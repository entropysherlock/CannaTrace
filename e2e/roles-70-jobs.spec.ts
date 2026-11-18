import { expect, test } from "@playwright/test";

/** Ten workplace screen-access tasks per built-in role (70 total).
 * This verifies role permissions and navigation, not 70 full business transactions.
 * Existing inventory, cultivation, manufacturing, distribution and POS E2E tests
 * provide separate full worker-flow coverage.
 */
test("owner: 10 workplace navigation and permission tasks", async ({page}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 1: /dashboard
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 2: /inventory
  await page.goto("/inventory");
  await expect(page).toHaveURL(new RegExp("/inventory/"));
  // Job 3: /inventory/receive
  await page.goto("/inventory/receive");
  await expect(page).toHaveURL(new RegExp("/inventory/receive/"));
  // Job 4: /cultivation
  await page.goto("/cultivation");
  await expect(page).toHaveURL(new RegExp("/cultivation/"));
  // Job 5: /manufacturing
  await page.goto("/manufacturing");
  await expect(page).toHaveURL(new RegExp("/manufacturing/"));
  // Job 6: /distribution
  await page.goto("/distribution");
  await expect(page).toHaveURL(new RegExp("/distribution/"));
  // Job 7: /pos
  await page.goto("/pos");
  await expect(page).toHaveURL(new RegExp("/pos/"));
  // Job 8: /labels
  await page.goto("/labels");
  await expect(page).toHaveURL(new RegExp("/labels/"));
  // Job 9: /settings
  await page.goto("/settings");
  await expect(page).toHaveURL(new RegExp("/settings/"));
  // Job 10: /team
  await page.goto("/team");
  await expect(page).toHaveURL(new RegExp("/team/"));
});

test("manager: 10 workplace navigation and permission tasks", async ({page}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 1: /dashboard
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 2: /inventory
  await page.goto("/inventory");
  await expect(page).toHaveURL(new RegExp("/inventory/"));
  // Job 3: /inventory/receive
  await page.goto("/inventory/receive");
  await expect(page).toHaveURL(new RegExp("/inventory/receive/"));
  // Job 4: /cultivation
  await page.goto("/cultivation");
  await expect(page).toHaveURL(new RegExp("/cultivation/"));
  // Job 5: /manufacturing
  await page.goto("/manufacturing");
  await expect(page).toHaveURL(new RegExp("/manufacturing/"));
  // Job 6: /distribution
  await page.goto("/distribution");
  await expect(page).toHaveURL(new RegExp("/distribution/"));
  // Job 7: /pos
  await page.goto("/pos");
  await expect(page).toHaveURL(new RegExp("/pos/"));
  // Job 8: /labels
  await page.goto("/labels");
  await expect(page).toHaveURL(new RegExp("/labels/"));
  // Job 9: /compliance
  await page.goto("/compliance");
  await expect(page).toHaveURL(new RegExp("/compliance/"));
  // Job 10: /team
  await page.goto("/team");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
});

test("inventory: 10 workplace navigation and permission tasks", async ({page}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("inventory@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 1: /dashboard
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 2: /inventory
  await page.goto("/inventory");
  await expect(page).toHaveURL(new RegExp("/inventory/"));
  // Job 3: /inventory/receive
  await page.goto("/inventory/receive");
  await expect(page).toHaveURL(new RegExp("/inventory/receive/"));
  // Job 4: /cultivation
  await page.goto("/cultivation");
  await expect(page).toHaveURL(new RegExp("/cultivation/"));
  // Job 5: /manufacturing
  await page.goto("/manufacturing");
  await expect(page).toHaveURL(new RegExp("/manufacturing/"));
  // Job 6: /distribution
  await page.goto("/distribution");
  await expect(page).toHaveURL(new RegExp("/distribution/"));
  // Job 7: /labels
  await page.goto("/labels");
  await expect(page).toHaveURL(new RegExp("/labels/"));
  // Job 8: /reports
  await page.goto("/reports");
  await expect(page).toHaveURL(new RegExp("/reports/"));
  // Job 9: /compliance
  await page.goto("/compliance");
  await expect(page).toHaveURL(new RegExp("/compliance/"));
  // Job 10: /pos
  await page.goto("/pos");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
});

test("cultivation: 10 workplace navigation and permission tasks", async ({page}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("cultivation@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 1: /dashboard
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 2: /cultivation
  await page.goto("/cultivation");
  await expect(page).toHaveURL(new RegExp("/cultivation/"));
  // Job 3: /inventory
  await page.goto("/inventory");
  await expect(page).toHaveURL(new RegExp("/inventory/"));
  // Job 4: /labels
  await page.goto("/labels");
  await expect(page).toHaveURL(new RegExp("/labels/"));
  // Job 5: /manufacturing
  await page.goto("/manufacturing");
  await expect(page).toHaveURL(new RegExp("/manufacturing/"));
  // Job 6: /distribution
  await page.goto("/distribution");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 7: /inventory/receive
  await page.goto("/inventory/receive");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 8: /pos
  await page.goto("/pos");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 9: /compliance
  await page.goto("/compliance");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 10: /team
  await page.goto("/team");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
});

test("sales: 10 workplace navigation and permission tasks", async ({page}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("sales@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 1: /dashboard
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 2: /distribution
  await page.goto("/distribution");
  await expect(page).toHaveURL(new RegExp("/distribution/"));
  // Job 3: /inventory
  await page.goto("/inventory");
  await expect(page).toHaveURL(new RegExp("/inventory/"));
  // Job 4: /reports
  await page.goto("/reports");
  await expect(page).toHaveURL(new RegExp("/reports/"));
  // Job 5: /labels
  await page.goto("/labels");
  await expect(page).toHaveURL(new RegExp("/labels/"));
  // Job 6: /cultivation
  await page.goto("/cultivation");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 7: /manufacturing
  await page.goto("/manufacturing");
  await expect(page).toHaveURL(new RegExp("/manufacturing/"));
  // Job 8: /pos
  await page.goto("/pos");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 9: /settings
  await page.goto("/settings");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 10: /integrations
  await page.goto("/integrations");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
});

test("budtender: 10 workplace navigation and permission tasks", async ({page}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("budtender@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 1: /dashboard
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 2: /pos
  await page.goto("/pos");
  await expect(page).toHaveURL(new RegExp("/pos/"));
  // Job 3: /inventory
  await page.goto("/inventory");
  await expect(page).toHaveURL(new RegExp("/inventory/"));
  // Job 4: /labels
  await page.goto("/labels");
  await expect(page).toHaveURL(new RegExp("/labels/"));
  // Job 5: /cultivation
  await page.goto("/cultivation");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 6: /inventory/receive
  await page.goto("/inventory/receive");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 7: /distribution
  await page.goto("/distribution");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 8: /reports
  await page.goto("/reports");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 9: /settings
  await page.goto("/settings");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 10: /team
  await page.goto("/team");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
});

test("readonly: 10 workplace navigation and permission tasks", async ({page}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("readonly@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 1: /dashboard
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 2: /inventory
  await page.goto("/inventory");
  await expect(page).toHaveURL(new RegExp("/inventory/"));
  // Job 3: /cultivation
  await page.goto("/cultivation");
  await expect(page).toHaveURL(new RegExp("/cultivation/"));
  // Job 4: /distribution
  await page.goto("/distribution");
  await expect(page).toHaveURL(new RegExp("/distribution/"));
  // Job 5: /reports
  await page.goto("/reports");
  await expect(page).toHaveURL(new RegExp("/reports/"));
  // Job 6: /compliance
  await page.goto("/compliance");
  await expect(page).toHaveURL(new RegExp("/compliance/"));
  // Job 7: /audit
  await page.goto("/audit");
  await expect(page).toHaveURL(new RegExp("/audit/"));
  // Job 8: /inventory/receive
  await page.goto("/inventory/receive");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 9: /pos
  await page.goto("/pos");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
  // Job 10: /team
  await page.goto("/team");
  await expect(page).toHaveURL(new RegExp("/dashboard/"));
});
