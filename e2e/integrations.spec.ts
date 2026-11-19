import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const run = `INT${Date.now().toString(36).toUpperCase()}`;
const seen = (page: Page, text: string | RegExp) => page.getByText(text).filter({ visible: true }).first();

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // Signing in returns people to the facility they last used; these checks are about the demo grow.
  await page.locator('select[name="facilityId"]').selectOption({ label: "Rio Grande Grow & Lab · DEMO-CULT-0001" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Rio Grande Grow & Lab · license DEMO-CULT-0001")).toBeVisible();
}

test("reports, CSV export and import, API keys, and the REST API", async ({ page, request }) => {
  await signIn(page, "owner@demo.test");

  // Reports
  await page.getByRole("link", { name: "Reports" }).first().click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(seen(page, "Inventory value at cost")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Flower", exact: true })).toBeVisible();

  // Export packages
  await page.goto("/data");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV" }).first().click()]);
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.split("\r\n")[0]).toBe("tag,sku,item,status,quantity,unit,location,lotNumber,costPerUnit,createdAt");
  expect(csv).toContain("CT-000001,FLW-BM-BULK,Blue Mesa Flower (bulk)");

  // Import: a bad file changes nothing and lists problems; a good one works
  await page.locator('select[name="kind"]').selectOption("items");
  await page.locator('form:has(select[name="kind"]) input[name="file"]').setInputFiles({
    name: "items.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`name,sku,category,unit\nGood,${run}-A,Flower,EACH\nBad,${run}-B,Flower,BUSHEL\n`),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(seen(page, "Nothing was imported")).toBeVisible();
  await expect(seen(page, /Line 3: unit must be one of/)).toBeVisible();
  await page.locator('select[name="kind"]').selectOption("items");
  await page.locator('form:has(select[name="kind"]) input[name="file"]').setInputFiles({
    name: "items.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`name,sku,category,unit\nImported jar,${run}-A,Flower,EACH\n`),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(seen(page, "Imported 1 row of items.")).toBeVisible();

  // API key
  await page.goto("/integrations");
  await page.locator('input[name="name"]').first().fill(`Test ${run}`);
  await page.locator('input[name="canWrite"]').check();
  await page.getByRole("button", { name: "Create key" }).click();
  const shown = await seen(page, /Copy this key now/).innerText();
  const key = shown.match(/ct_[A-Za-z0-9_-]+/)![0];

  const auth = { Authorization: `Bearer ${key}` };
  expect((await request.get("/api/v1/packages")).status()).toBe(401);
  const list = await request.get("/api/v1/packages?status=active&limit=2", { headers: auth });
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.data).toHaveLength(2);
  expect(typeof body.data[0].quantity).toBe("string");
  expect(body.nextOffset).toBe(2);

  const one = await request.get("/api/v1/packages/ct-000006", { headers: auth });
  expect((await one.json()).data).toMatchObject({ tag: "CT-000006", unit: "KG" });
  expect((await request.get("/api/v1/packages/NOPE-1", { headers: auth })).status()).toBe(422);

  const adjust = await request.post("/api/v1/packages/CT-000006/adjust", { headers: auth, data: { newQuantity: "18", reasonCode: "SCALE_VARIANCE", note: "API test" } });
  expect(adjust.status()).toBe(200);
  expect((await adjust.json()).data).toMatchObject({ tag: "CT-000006", quantity: "18" });
  const refused = await request.post("/api/v1/packages/CT-000006/adjust", { headers: auth, data: { newQuantity: "18", reasonCode: "NOPE" } });
  expect(await refused.json()).toEqual({ error: "Choose a reason for the adjustment." });
  const garbled = await request.fetch("/api/v1/packages/CT-000006/adjust", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, data: Buffer.from("{oops") });
  expect(garbled.status()).toBe(400);
  expect(await garbled.json()).toEqual({ error: "The request body must be valid JSON." });
  expect((await request.post("/api/v1/packages/CT-000006/adjust", { headers: auth, data: [1, 2] })).status()).toBe(400);

  // The API change is in the audit trail under the key's name
  await page.goto("/audit");
  await expect(seen(page, `API key "Test ${run}"`)).toBeVisible();

  // Revoke it
  await page.goto("/integrations");
  await page.locator("li", { hasText: `Test ${run}` }).getByRole("button", { name: "Revoke" }).click();
  await expect(seen(page, /revoked/)).toBeVisible();
  expect((await request.get("/api/v1/items", { headers: auth })).status()).toBe(401);

  // Webhook: private addresses are refused
  await page.locator('input[name="url"]').fill("https://169.254.169.254/latest");
  await page.locator('input[name="events"][value="RETAIL_SALE"]').check();
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(seen(page, "Webhook addresses must be on the public internet")).toBeVisible();
});

test("a read-only API key cannot make changes, and managers cannot open Integrations", async ({ page, request }) => {
  await signIn(page, "owner@demo.test");
  await page.goto("/integrations");
  await page.locator('input[name="name"]').first().fill(`Reader ${run}`);
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await seen(page, /Copy this key now/).innerText()).match(/ct_[A-Za-z0-9_-]+/)![0];
  const write = await request.post("/api/v1/packages/CT-000006/adjust", { headers: { Authorization: `Bearer ${key}` }, data: { newQuantity: "1", reasonCode: "DAMAGE" } });
  expect(write.status()).toBe(403);
  expect((await request.get("/api/v1/items", { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(200);

  await page.getByLabel("Your account").click();
  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, "manager@demo.test");
  await expect(page.getByRole("link", { name: "Integrations" })).toHaveCount(0);
  await page.goto("/integrations");
  await expect(page).toHaveURL(/\/dashboard/);
  expect((await page.request.get("/export/audit")).status()).toBe(200);
});
