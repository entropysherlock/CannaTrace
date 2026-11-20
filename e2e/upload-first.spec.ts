import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const png = () => sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 240, g: 240, b: 235 } } }).png().toBuffer();

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();
}

async function firstPackageId(page: Page) {
  await page.goto("/inventory");
  const href = await page.locator('a[href^="/inventory/"]').evaluateAll((as) => (as as HTMLAnchorElement[]).map((a) => a.getAttribute("href") ?? "").find((h) => /^\/inventory\/[0-9a-f-]{20,}$/.test(h)));
  expect(href, "a package link").toBeTruthy();
  return href!.split("/").pop()!;
}

test("the lab result form starts as a drop zone, fills itself from a file, and the manual form is one quiet click away", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page);
  const id = await firstPackageId(page);
  await page.goto(`/inventory/${id}`);
  await page.getByText("Add lab result").click();
  const drop = page.getByTestId("document-drop");
  await expect(drop).toBeVisible();
  await expect(page.locator('input[name="labName"]')).toHaveCount(0);

  await page.getByTestId("enter-manually").click();
  await expect(page.locator('input[name="labName"]')).toBeVisible();
  await page.getByRole("button", { name: "Drop it here instead" }).click();

  await page.getByTestId("drop-input").setInputFiles({ name: "coa-desert-haze.png", mimeType: "image/png", buffer: await png() });
  await expect(page).toHaveURL(new RegExp(`/inbox/[0-9a-f-]+\\?package=${id}`), { timeout: 40_000 });
  await expect(page.getByText("You started from this package")).toBeVisible();
  await expect(page.locator('input[name="package"]:checked')).toHaveCount(1);
});

test("pasting a screenshot anywhere reads it and opens the review", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/dashboard");
  const b64 = (await png()).toString("base64");
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "pasted-coa.png", { type: "image/png" }));
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64);
  await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]+$/, { timeout: 40_000 });
  await expect(page.getByRole("heading", { name: "Review a document" })).toBeVisible();
});

test("a photo sent from the phone opens its review on the desktop by itself", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/dashboard");
  await page.waitForTimeout(1500); // the desktop has taken its first look
  const body = await png();
  const start = await page.request.post("/api/assistant/attachments", { data: { name: "phone-coa.png", size: body.length, source: "phone" } });
  const { id, chunkBytes } = await start.json();
  expect(chunkBytes).toBeGreaterThan(0);
  expect((await page.request.put(`/api/assistant/attachments/${id}?offset=0`, { data: body })).ok()).toBe(true);
  expect((await page.request.post(`/api/assistant/attachments/${id}`)).ok()).toBe(true);
  expect((await page.request.post(`/api/scan/${id}`)).ok()).toBe(true);

  await expect(page.getByTestId("phone-handoff")).toContainText("Your phone sent a lab certificate", { timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/inbox/${id}$`), { timeout: 15_000 });
});
