import { expect, test, type Page } from "@playwright/test";

/**
 * The five walkthroughs for new employees, each done for real by the role it's for: every highlighted
 * step must find its target on the live page (no "That isn't on this page" note), and the real action
 * must move the walkthrough on.
 */

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

const STORE = "Sandia Storefront · DEMO-RET-0002";
const GROW = "Rio Grande Grow & Lab · DEMO-CULT-0001";

async function start(page: Page, id: string) {
  await page.goto(`/dashboard?walk=${id}`);
  await expect(page.getByTestId("walk-bubble")).toBeVisible();
}

/** The bubble is on the given step, and its highlight was found on the page. */
async function onStep(page: Page, title: string, highlighted = true) {
  const bubble = page.getByTestId("walk-bubble");
  await expect(bubble).toContainText(title);
  // On top of everything, including the full-screen register: what's under the bubble's middle is the bubble.
  expect(
    await bubble.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }),
  ).toBe(true);
  if (highlighted) {
    await expect(page.getByTestId("walk-spotlight")).toBeVisible();
    await expect(bubble).not.toContainText("isn't on this page");
  }
  return bubble;
}

const next = (page: Page) => page.getByTestId("walk-bubble").getByTestId("walk-next").click();

async function finish(page: Page, title: string) {
  await page.getByTestId("walk-bubble").getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "You finished" })).toContainText(`You finished “${title}”`);
}

test("Run a register shift: open the drawer, check ID, sell, pay, receipt, blind count", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "budtender@demo.test", STORE);
  await start(page, "register-shift");
  await expect(page).toHaveURL(/\/pos$/);

  await onStep(page, "Open your drawer");
  await page.getByLabel("Starting cash").fill("150");
  await page.getByRole("button", { name: "Open drawer" }).click();

  await onStep(page, "Check their ID");
  await page.getByRole("button", { name: /Type the dates/ }).click();
  await page.getByLabel("Date of birth on the ID").fill("1984-06-01");
  await page.getByLabel("ID expiry date").fill("2031-06-30");
  await page.getByRole("button", { name: "Start sale" }).click();

  await expect(page).toHaveURL(/\/pos\/sales\/[^/]+$/);
  await onStep(page, "Ring up and take payment");
  await page.getByRole("button", { name: /^Add Desert Haze 1 g Pre-roll/ }).click();
  await page.getByRole("button", { name: /^Pay/ }).click();

  // The payment window sits above the walkthrough, so nothing covers Complete sale.
  const pay = page.getByRole("dialog", { name: /Take payment/ });
  await pay.getByLabel(/Cash received/).fill("20");
  await pay.getByRole("button", { name: /Complete sale/ }).click();

  await expect(page).toHaveURL(/\/receipt$/);
  await onStep(page, "Hand over the receipt");
  await next(page);

  await expect(page).toHaveURL(/\/pos\/drawer$/);
  await onStep(page, "Count out at the end of your shift");
  await expect(page.getByText("Cash that should be in the drawer")).toHaveCount(0); // blind count
  await page.getByLabel("Cash counted in the drawer").fill("159.56");
  await page.getByRole("button", { name: "Close drawer" }).click();

  await expect(page).toHaveURL(/\/pos\/drawer\/[^/]+$/);
  await onStep(page, "Your end-of-shift report", false);
  await finish(page, "Run a register shift");
});

test("Run a register shift skips opening the drawer when it's already open", async ({ page }) => {
  await signIn(page, "manager@demo.test", STORE);
  await page.goto("/pos");
  if (await page.getByRole("button", { name: "Open drawer" }).isVisible()) {
    await page.getByLabel("Starting cash").fill("100");
    await page.getByRole("button", { name: "Open drawer" }).click();
    await expect(page.getByText("Scan the barcode on the back of the ID")).toBeVisible();
  }
  await start(page, "register-shift");
  await onStep(page, "Check their ID");
});

test("Find and move a package", async ({ page }) => {
  await signIn(page, "inventory@demo.test", GROW);
  await start(page, "find-and-move");
  await expect(page).toHaveURL(/\/inventory$/);

  await onStep(page, "Scan or search");
  await page.getByRole("main").locator('input[name="q"]').fill("CT-000006");
  await page.getByRole("main").getByRole("button", { name: "Search" }).click();
  await next(page);

  await onStep(page, "Open the package");
  await page.getByRole("link", { name: /CT-000006/ }).first().click();
  await expect(page.getByRole("heading", { name: "CT-000006" })).toBeVisible();

  await onStep(page, "Check what you have");
  await next(page);

  await onStep(page, "Move it");
  await page.getByRole("main").getByLabel("New location").selectOption({ label: "Vault A / Rack 2" });
  await page.getByRole("button", { name: "Move package" }).click();

  await onStep(page, "There's the record");
  await expect(page.getByText("Vault A / Rack 2").first()).toBeVisible();
  await finish(page, "Find and move a package");
});

test("Count a room", async ({ page }) => {
  await signIn(page, "inventory@demo.test", GROW);
  await start(page, "count-a-room");
  await expect(page).toHaveURL(/\/counts$/);

  await onStep(page, "Pick the room");
  await page.getByRole("link", { name: /Vault A \/ Rack 1/ }).click();
  await expect(page).toHaveURL(/\/counts\/[^/]+$/);

  await onStep(page, "Count what's really there", false);
  const boxes = page.locator('input[name^="counted:"]');
  for (let i = 0; i < (await boxes.count()); i++) {
    const says = (await boxes.nth(i).locator("xpath=ancestor::li").innerText()).match(/system says ([\d.]+)/)![1];
    await boxes.nth(i).fill(says);
  }
  await next(page);

  await onStep(page, "Save the count");
  await page.getByRole("button", { name: "Save count" }).click();
  await expect(page.getByText(/Count saved/)).toBeVisible();

  await onStep(page, "Big difference?", false);
  await finish(page, "Count a room");
});

test("Hold and destroy waste", async ({ page }) => {
  await signIn(page, "inventory@demo.test", GROW);
  await start(page, "hold-and-destroy");

  await onStep(page, "Find the product");
  await page.getByRole("main").locator('input[name="q"]').fill("CT-000006");
  await page.getByRole("main").getByRole("button", { name: "Search" }).click();
  await next(page);

  await onStep(page, "Open it");
  await page.getByRole("link", { name: /CT-000006/ }).first().click();

  await onStep(page, "Put it on hold");
  await page.locator('form:has(input[name="reason"]) select[name="status"]').selectOption("ON_HOLD");
  await page.locator('input[name="reason"]').fill("Moldy trim, 2 bags (walkthrough test)");
  await page.getByRole("button", { name: "Update status" }).click();

  await onStep(page, "Wait out the hold period", false);
  await next(page);

  await onStep(page, "Destroy it when the time comes");
  // Too early: CannaTrace refuses and says when it becomes allowed
  await page.locator('form:has(input[name="reason"]) select[name="status"]').selectOption("DESTROYED");
  await page.locator('input[name="reason"]').fill("Mixed with cat litter");
  await page.getByRole("checkbox", { name: /mixed with at least 50%/ }).check();
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText(/can be destroyed after/)).toBeVisible();
  await finish(page, "Hold and destroy waste");
});

test("Your morning check with Tally", async ({ page }) => {
  await signIn(page, "budtender@demo.test", STORE);
  await start(page, "morning-check");
  await expect(page).toHaveURL(/\/dashboard/);

  await onStep(page, "Start at the Dashboard", false);
  await next(page);

  await expect(page).toHaveURL(/\/watch$/);
  await onStep(page, "What Tally Watch found");
  await next(page);
  await onStep(page, "Fix it, or ask", false);
  await next(page);
  await onStep(page, "Ask Tally anything", false);
  await finish(page, "Your morning check with Tally");
});

test("each role only sees the new walkthroughs it can do", async ({ page }) => {
  await signIn(page, "budtender@demo.test");
  await page.goto("/walkthroughs");
  await expect(page.getByTestId("start-register-shift")).toBeVisible();
  await expect(page.getByTestId("start-morning-check")).toBeVisible();
  await expect(page.getByTestId("start-count-a-room")).toHaveCount(0);
  await expect(page.getByTestId("start-hold-and-destroy")).toHaveCount(0);
});
