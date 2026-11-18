import { expect, test, type Page } from "@playwright/test";

const tag = `WALK${Date.now().toString(36).toUpperCase()}`;

async function signIn(page: Page, email = "owner@demo.test") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("Show me how walks an employee through receiving a delivery, page to page", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("show-me-how").click();
  await expect(page.getByRole("dialog", { name: "Show me how" })).toBeVisible();
  await page.getByTestId("walk-receive-delivery").click();

  // It takes them to the receive page and highlights the tag field
  await expect(page).toHaveURL(/\/inventory\/receive$/);
  const bubble = page.getByTestId("walk-bubble");
  await expect(bubble).toContainText("step 1 of 5");
  await expect(bubble).toContainText("Scan the tag");
  await expect(page.getByTestId("walk-spotlight")).toBeVisible();
  await page.locator('input[name="tag"]').fill(tag);
  await bubble.getByTestId("walk-next").click();

  await expect(bubble).toContainText("What is it?");
  await page.locator('select[name="itemId"]').selectOption({ index: 1 });
  await bubble.getByTestId("walk-next").click();
  await expect(bubble).toContainText("How much arrived");
  await page.locator('input[name="quantity"]').fill("5");
  await page.locator('select[name="locationId"]').selectOption({ index: 1 });
  await bubble.getByTestId("walk-next").click();

  // A click step: pressing the highlighted Receive button moves it on, and the package page finishes it
  await expect(bubble).toContainText("Click the highlighted spot");
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: tag })).toBeVisible();
  await expect(bubble).toContainText("step 5 of 5");
  await bubble.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("status")).toContainText("You finished “Receive a delivery”");
  await expect(bubble).toHaveCount(0);
});

test("a walkthrough survives a reload, offers to take you back, and can be exited", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard?walk=make-a-product");
  await expect(page).toHaveURL(/\/manufacturing\/recipes$/);
  const bubble = page.getByTestId("walk-bubble");
  await expect(bubble).toContainText("Write the recipe once");
  await expect(page.getByTestId("walk-spotlight")).toBeVisible();

  await page.reload();
  await expect(bubble).toContainText("step 1 of 6");

  // Wandering off: the bubble says so and brings them back
  await page.goto("/inventory");
  await expect(bubble).toContainText("This step happens on another page");
  await bubble.getByRole("button", { name: "Take me there" }).click();
  await expect(page).toHaveURL(/\/manufacturing\/recipes$/);

  // Next moves to the runs page; clicking New run (or the open form) carries on
  await bubble.getByTestId("walk-next").click();
  await bubble.getByRole("button", { name: "Take me there" }).click();
  await expect(page).toHaveURL(/\/manufacturing$/);
  await expect(bubble).toContainText("Start a run");
  await expect(page.getByTestId("walk-spotlight")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(bubble).toHaveCount(0);
});

test("Harvest to shelf finds the harvest list and a harvest's cards", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard?walk=harvest-to-shelf");
  await expect(page).toHaveURL(/\/cultivation\/harvests$/);
  const bubble = page.getByTestId("walk-bubble");
  await expect(bubble).toContainText("Open a harvest");
  await expect(page.getByTestId("walk-spotlight")).toBeVisible();
  await page.locator('main a[href^="/cultivation/harvests/"]').first().click();
  await expect(bubble).toContainText("step 2 of 7");
  await expect(page.getByTestId("walk-spotlight")).toBeVisible();
});
