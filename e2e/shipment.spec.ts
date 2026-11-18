import { expect, test } from "@playwright/test";

const run = `MF${Date.now().toString(36).toUpperCase()}`;

test("a shipment is received against its manifest, with the short line explained, and the state gets one record", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/inventory/receive");
  await page.getByRole("link", { name: "Receive it against the manifest" }).click();
  await expect(page.getByRole("heading", { name: "Receive a shipment" })).toBeVisible();

  const form = page.getByTestId("shipment-form");
  await form.getByLabel("Manifest number").fill(run);
  await form.getByLabel("Put away to").selectOption({ label: "Vault A" });
  const csv = ["Package Tag,Item Name,Quantity", `${run}-1,Blue Mesa 3.5 g Jar,40`, `${run}-2,Desert Haze 1 g Pre-roll,100`].join("\n");
  await form.getByLabel("Manifest file (CSV or Excel)").setInputFiles({ name: "manifest.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await form.getByRole("button", { name: "Check the manifest" }).click();
  await expect(form.getByTestId("shipment-lines")).toContainText("Blue Mesa 3.5 g Jar");

  // 90 of 100 pre-rolls arrived: it can't be received until the difference is explained
  await form.getByLabel(`Arrived for ${run}-2`).fill("90");
  await form.getByLabel(`Arrived for ${run}-2`).blur();
  await expect(form.getByTestId("shipment-problems")).toContainText("90 of 100 arrived. Say why");
  await expect(form.getByRole("button", { name: /^Receive \d/ })).toHaveCount(0);
  await form.getByLabel(`Why ${run}-2 is different`).fill("10 crushed in transit");
  await form.getByLabel(`Why ${run}-2 is different`).blur();
  await form.getByRole("button", { name: "Receive 2 packages" }).click();
  await expect(page.getByTestId("shipment-received")).toContainText(`Received manifest ${run}: 2 packages, 1 short.`);

  // One record for State reporting, for the whole manifest
  await page.getByRole("link", { name: "See State reporting" }).click();
  await expect(page.getByText(`Accept manifest ${run}: 2 packages received, 1 short`).first()).toBeVisible();
  await page.goto(`/inventory?q=${run}-2`);
  await expect(page.getByText(`${run}-2`).first()).toBeVisible();
});
