import { expect, test } from "@playwright/test";

test("the phone screen has a scanner, and a scanned tag is looked up", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/inventory");
  const tag = (await page.locator("body").innerText()).match(/\bCT-\d{6}\b/)?.[0];
  expect(tag, "a package tag on the inventory page").toBeTruthy();

  const found = await page.request.get(`/api/scan/lookup?code=${encodeURIComponent(tag!.toLowerCase())}`);
  expect((await found.json()).found?.kind).toBe("package");
  const nothing = await page.request.get("/api/scan/lookup?code=NOT-A-REAL-CODE");
  expect((await nothing.json()).found).toBeNull();

  await page.goto("/capture");
  await expect(page.getByTestId("scan-barcode")).toBeVisible();
});
