import { expect, test } from "@playwright/test";

test("dropping a spreadsheet anywhere says where spreadsheets go, instead of just failing", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["name,sku,category,unit,strain\n"], "items.csv", { type: "text/csv" }));
    document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("alert").filter({ hasText: "spreadsheet" })).toContainText("reads photos and PDFs");
  await expect(page.getByTestId("drop-sheet-help").getByRole("link", { name: "Open Import and export" })).toHaveAttribute("href", "/data");
});
