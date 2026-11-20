import { expect, test } from "@playwright/test";
import sharp from "sharp";

const png = () => sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 30, g: 120, b: 60 } } }).png().toBuffer();

test("link a phone with a QR code, send a photo from it, and unlink it", async ({ browser }) => {
  test.setTimeout(150_000);
  const desktop = await (await browser.newContext()).newPage();
  await desktop.goto("/login");
  await desktop.getByLabel("Email").fill("manager@demo.test");
  await desktop.getByLabel("Password").fill("demo1234");
  await desktop.getByRole("button", { name: "Sign in" }).click();
  await expect(desktop).toHaveURL(/\/dashboard/);
  await desktop.locator('select[name="facilityId"]').selectOption({ label: "Sandia Storefront · DEMO-RET-0002" });
  await desktop.getByRole("button", { name: "Switch" }).click();
  await expect(desktop.getByText("Sandia Storefront · license DEMO-RET-0002")).toBeVisible();

  // The camera is one tap from anywhere in the app
  await expect(desktop.getByTestId("camera-link")).toHaveAttribute("href", "/capture");
  await desktop.goto("/account");
  await desktop.getByTestId("show-qr").click();
  await expect(desktop.getByTestId("qr").locator("svg")).toBeVisible();
  const url = await desktop.getByTestId("pair-url").inputValue();
  expect(url).toMatch(/\/link\/[A-Za-z0-9_-]{30,}$/);

  // The phone: a separate browser with no sign-in at all
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(url);
  await expect(phone.getByRole("heading", { name: "Link this phone" })).toBeVisible();
  await phone.getByRole("button", { name: "Link this phone" }).click();
  await expect(phone).toHaveURL(/\/capture\?linked=1/);
  await expect(phone.getByTestId("linked-note")).toBeVisible();
  await expect(phone.getByTestId("take-photo")).toBeVisible();
  // From inside the app, the camera is one tap away
  await phone.getByRole("link", { name: "Open CannaTrace" }).click();
  await expect(phone).toHaveURL(/\/dashboard/);
  await phone.getByTestId("camera-link").click();
  await expect(phone.getByTestId("take-photo")).toBeVisible();

  // The code is used up
  const again = await (await browser.newContext()).newPage();
  await again.goto(url);
  await expect(again.getByTestId("link-problem")).toContainText("already used");

  // Take a photo: it goes to the inbox
  await phone.getByTestId("camera-input").setInputFiles({ name: "coa.png", mimeType: "image/png", buffer: await png() });
  await expect(phone.getByTestId("shots")).toContainText(/Ready to review|It is in your inbox/, { timeout: 40_000 });
  await desktop.goto("/inbox");
  await expect(desktop.getByTestId("inbox")).toContainText("coa.png");
  await expect(desktop.getByTestId("inbox").locator("img").first()).toBeVisible();

  // The phone's sign-in runs out: opening the app signs it back in with no password
  await phoneContext.clearCookies({ name: "ct_session" });
  await phone.goto("/capture");
  await expect(phone.getByTestId("take-photo")).toBeVisible();

  // Unlink it on the computer: the phone can no longer get in
  await desktop.goto("/account");
  await expect(desktop.getByTestId("phones")).toContainText("Phone or tablet");
  const phoneRows = desktop.locator('[data-testid="phones"] li');
  const before = await phoneRows.count();
  await phoneRows.first().getByRole("button", { name: "Unlink" }).click(); // newest first: the one just linked
  await expect(phoneRows).toHaveCount(before - 1);
  await phoneContext.clearCookies({ name: "ct_session" });
  await phone.goto("/capture");
  await expect(phone).toHaveURL(/\/login/);

  // Tidy up: the uploaded photo
  await desktop.goto("/inbox");
  const items = desktop.locator('[data-testid="inbox"] li');
  const total = await items.count();
  await items.first().getByRole("button", { name: "Delete" }).click(); // newest first: the photo just sent
  if (total === 1) await expect(desktop.getByTestId("inbox-empty")).toBeVisible();
  else await expect(items).toHaveCount(total - 1);
});
