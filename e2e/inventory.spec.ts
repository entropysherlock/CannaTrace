import { expect, test, type Page } from "@playwright/test";

const run = `E2E${Date.now().toString(36).toUpperCase()}`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page).toHaveURL(/\/login/);
});

test("a wrong password is rejected with a clear message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("do not match");
});

test("receive, move, adjust, split, hold, lab result, label, and count", async ({ page }) => {
  await signIn(page, "inventory@demo.test");

  // Receive
  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(`${run}-A`);
  await page.locator('select[name="itemId"]').selectOption({ label: "Blue Mesa Flower (bulk) (g)" });
  await page.locator('input[name="quantity"]').fill("100");
  await page.locator('select[name="locationId"]').selectOption({ label: "Dry Room" });
  await page.locator('input[name="lotNumber"]').fill("LOT-E2E");
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: `${run}-A` })).toBeVisible();
  await expect(page.getByText("100 g").first()).toBeVisible();
  const packageUrl = page.url();

  // A duplicate tag is refused
  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(`${run}-A`);
  await page.locator('select[name="itemId"]').selectOption({ label: "Blue Mesa Flower (bulk) (g)" });
  await page.locator('input[name="quantity"]').fill("1");
  await page.locator('select[name="locationId"]').selectOption({ label: "Dry Room" });
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("already in use");

  // Move
  await page.goto(packageUrl);
  await page.locator("summary", { hasText: "Move" }).click();
  await page.locator('select[name="toLocationId"]').selectOption({ label: "Vault A" });
  await page.getByRole("button", { name: "Move package" }).click();
  await expect(page.getByText("Package moved.")).toBeVisible();
  await expect(page.getByText("Dry Room → Vault A")).toBeVisible();

  // Adjust
  await page.locator("summary", { hasText: "Adjust quantity" }).click();
  await page.locator('input[name="newQuantity"]').fill("98.5");
  await page.locator('select[name="reasonCode"]').selectOption({ label: "Moisture loss / drying" });
  await page.getByRole("button", { name: "Save adjustment" }).click();
  await expect(page.getByText("Quantity adjusted and logged.")).toBeVisible();
  await expect(page.getByText("100 → 98.5 g (-1.5)")).toBeVisible();

  // Split: too much is refused, then a valid split works
  await page.locator("summary", { hasText: "Split into new packages" }).click();
  await page.getByLabel("New tag 1").fill(`${run}-B`);
  await page.getByLabel("Quantity 1").fill("500");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("only holds 98.5");
  await expect(page.getByLabel("New tag 1")).toHaveValue(`${run}-B`); // typed values survive an error
  await page.getByLabel("Quantity 1").fill("28");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.getByText(`Created ${run}-B.`)).toBeVisible();
  await expect(page.getByText("70.5 g").first()).toBeVisible();
  await expect(page.getByRole("link", { name: `${run}-B` })).toBeVisible();

  // Lab result with a COA; a fail quarantines the package
  await page.locator("summary", { hasText: "Add lab result" }).click();
  await page.locator('input[name="labName"]').fill("Mesa Analytical");
  await page.locator('form:has(input[name="labName"]) select[name="status"]').selectOption("FAIL");
  await page.locator('input[name="thcPercent"]').fill("21.4");
  await page.locator('input[name="coa"]').setInputFiles({
    name: "coa.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% test certificate\n"),
  });
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByText("now quarantined")).toBeVisible();
  await expect(page.getByText("THC 21.4%")).toBeVisible();
  const coaHref = await page.getByRole("link", { name: /View COA/ }).getAttribute("href");
  const coa = await page.request.get(coaHref!);
  expect(coa.status()).toBe(200);
  expect(coa.headers()["content-type"]).toBe("application/pdf");
  expect((await coa.body()).toString()).toContain("test certificate");

  // Quarantined packages cannot be split; release it
  await expect(page.locator("summary", { hasText: "Split into new packages" })).toHaveCount(0);
  await page.locator("summary", { hasText: "Hold, quarantine, or destroy" }).click();
  await page.locator('form:has(input[name="reason"]) select[name="status"]').selectOption("ACTIVE");
  await page.locator('input[name="reason"]').fill("Retest passed");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText("Status updated and logged.")).toBeVisible();

  // Label
  await page.getByRole("link", { name: "Print label" }).click();
  await expect(page).toHaveURL(/\/label$/);
  await expect(page.locator("main svg")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print label" })).toBeVisible();
  await expect(page.locator("main p.font-mono")).toHaveText(`${run}-A`);

  // Search finds it
  await page.goto(`/inventory?q=${run}-B`);
  await expect(page.getByText("1 package shown")).toBeVisible();

  // Cycle count on Vault A corrects only what differs
  await page.goto("/counts");
  await page.getByRole("link", { name: /^Vault A\s*\d+ package/ }).click();
  const inputs = page.locator('input[name^="counted:"]');
  await expect(inputs.first()).toBeVisible();
  const count = await inputs.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const row = inputs.nth(i).locator("xpath=ancestor::li");
    const text = await row.innerText();
    const system = text.match(/system says ([\d.]+)/)![1];
    await inputs.nth(i).fill(text.includes(`${run}-A`) ? "70" : system);
  }
  await page.getByRole("button", { name: "Save count" }).click();
  await expect(page.getByText(`1 of ${count} packages were corrected`)).toBeVisible();
});

test("a budtender cannot receive or open settings", async ({ page }) => {
  await signIn(page, "budtender@demo.test");
  await expect(page.getByRole("link", { name: "Receive" })).toHaveCount(0);
  await page.goto("/inventory/receive");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("merge two packages, add an item, add a location", async ({ page }) => {
  await signIn(page, "manager@demo.test");
  const ids: string[] = [];
  for (const suffix of ["M1", "M2"]) {
    await page.goto("/inventory/receive");
    await page.locator('input[name="tag"]').fill(`${run}-${suffix}`);
    await page.locator('select[name="itemId"]').selectOption({ label: "Mixed Trim (kg)" });
    await page.locator('input[name="quantity"]').fill(suffix === "M1" ? "2.5" : "1.25");
    await page.locator('select[name="locationId"]').selectOption({ label: "Dry Room" });
    await page.locator('input[name="lotNumber"]').fill("LOT-MERGE");
    await page.getByRole("button", { name: "Receive" }).click();
    await expect(page.getByRole("heading", { name: `${run}-${suffix}` })).toBeVisible();
    ids.push(page.url());
  }

  await page.locator("summary", { hasText: "Merge with other packages" }).click();
  await page.locator('textarea[name="otherTags"]').fill(`${run}-NOPE`);
  await page.locator('input[name="newTag"]').fill(`${run}-M3`);
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(`No package with tag ${run}-NOPE`);
  await page.locator('textarea[name="otherTags"]').fill(`${run}-m1`);
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${run}-M3` })).toBeVisible();
  await expect(page.getByText("3.75 kg").first()).toBeVisible();
  await expect(page.getByText("Made from:")).toBeVisible();
  await page.goto(ids[0]);
  await expect(page.getByText("finished").first()).toBeVisible();

  await page.goto("/catalog");
  await page.locator('form:has(select[name="unit"]) input[name="name"]').fill(`Test Rosin ${run}`);
  await page.locator('input[name="sku"]').fill(`ROS-${run}`);
  await page.locator('select[name="categoryId"]').selectOption({ label: "Concentrates" });
  await page.locator('select[name="unit"]').selectOption("G");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText(`Added Test Rosin ${run}.`)).toBeVisible();

  await page.goto("/locations");
  await page.locator('input[name="name"]').fill(`Bin ${run}`);
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(page.getByText(`Added Bin ${run}.`)).toBeVisible();
  await page.getByRole("button", { name: "Add location" }).click({ trial: true });
});

test("the setup screen is closed once accounts exist", async ({ page }) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a sign-in for an account that no longer exists is cleared instead of looping", async ({ page, context, baseURL }) => {
  const { SignJWT } = await import("jose");
  const token = await new SignJWT({ userId: "gone", orgId: "gone", facilityId: "gone", role: "OWNER", name: "Gone" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  await context.addCookies([{ name: "ct_session", value: token, url: baseURL! }]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === "ct_session")).toBeUndefined();
});

test("the public homepage shows the product and leads to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /From Seed to Sale/ })).toBeVisible();
  await expect(page.getByText("Example view. Figures are for illustration.")).toBeVisible();
  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page).toHaveURL(/\/signup/);
});
