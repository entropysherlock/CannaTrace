import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const run = `LBL${Date.now().toString(36).toUpperCase()}`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function switchFacility(page: Page, name: string) {
  const value = await page.locator("#facilityId option", { hasText: name }).getAttribute("value");
  // Start from another page so the redirect to the dashboard shows the switch finished.
  await page.goto("/labels/history");
  await page.locator("#facilityId").selectOption(value!);
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator("#facilityId option:checked")).toContainText(name);
}

test("SmartLabel sits under Operations, directly below Register", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  const links = await page.getByRole("navigation", { name: "Main" }).getByRole("link").allTextContents();
  const register = links.findIndex((l) => l.trim() === "Register");
  expect(register).toBeGreaterThan(-1);
  expect(links[register + 1].trim()).toBe("SmartLabel AI");
});

test("a new package's label fills in, checks, prints as an exact-size PDF, and reprints without touching inventory", async ({ page }) => {
  // Headless browsers can't show a print dialog; record print requests instead.
  await page.addInitScript(() => ((window as unknown as { __labelPrints: string[] }).__labelPrints = []));
  await signIn(page, "inventory@demo.test");

  // 1. Create a package
  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(`${run}-P`);
  await page.locator('select[name="itemId"]').selectOption({ label: "Blue Mesa Flower (bulk) (g)" });
  await page.locator('input[name="quantity"]').fill("25");
  await page.locator('select[name="locationId"]').selectOption({ label: "Dry Room" });
  await page.locator('input[name="lotNumber"]').fill("LOT-LBL");
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: `${run}-P` })).toBeVisible();
  const id = page.url().split("/").pop()!;

  // 2. Open its label action
  await page.getByRole("link", { name: "Print package label" }).click();
  await expect(page).toHaveURL(/\/labels\?kind=PACKAGE&ids=/);
  await expect(page.getByTestId("label-records").locator("label", { hasText: `${run}-P` }).getByRole("checkbox")).toBeChecked();

  // 3-5. The template fills in from the record, gets checked, and previews
  await page.getByRole("button", { name: "Check and preview" }).click();
  const previews = page.getByTestId("label-previews");
  await expect(previews).toContainText(`${run}-P`);
  await expect(previews).toContainText("Blue Mesa Flower (bulk)");
  await expect(previews).toContainText("25 g");
  await expect(page.getByTestId("label-issues")).toContainText("No blocking problems in 1 label");

  // 6-7. Create the job and get a PDF the exact size of the 4" x 2" label
  // One click creates the job and sends the PDF to the print dialog
  const pdfResponse = page.waitForResponse((r) => /\/api\/labels\/jobs\/[^/]+\/pdf$/.test(r.url()));
  await page.getByRole("button", { name: "Print 1 label" }).click();
  const jobBox = page.getByTestId("label-job");
  await expect(jobBox).toContainText("Sent 1 label to the print dialog.");
  await expect(page.locator("iframe#label-print-frame")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __labelPrints: string[] }).__labelPrints.length)).toBe(1);
  await expect(jobBox.getByRole("button", { name: "Print again" }).or(jobBox.getByRole("button", { name: "Print", exact: true }))).toBeVisible();
  const res = await pdfResponse;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  // Fetch the same PDF again to read its bytes (the browser keeps the first copy for the print tab).
  const pdf = await PDFDocument.load(await (await page.request.get(res.url())).body());
  expect(pdf.getPageCount()).toBe(1);
  const size = pdf.getPage(0).getSize();
  expect(size.width).toBeCloseTo(288, 1); // 101.6 mm
  expect(size.height).toBeCloseTo(144, 1); // 50.8 mm
  await jobBox.getByRole("button", { name: "It printed" }).click();
  await expect(jobBox.getByRole("button", { name: "Reprint" })).toBeVisible();

  // The job is in the history
  await page.goto("/labels/history");
  const firstRow = page.getByTestId("label-history").locator("tbody tr").first();
  await expect(firstRow).toContainText("Package label 4×2");
  await expect(firstRow).toContainText("printed");

  // 8. Reprint makes a new print job and nothing else
  await firstRow.getByRole("button", { name: "Reprint" }).click();
  // The new reprint job appears at the top of the history
  await expect(page.getByTestId("label-history").locator("tbody tr")).toHaveCount(2);
  await expect(page.getByTestId("label-history").locator("tbody tr").first()).toContainText("reprint");
  await page.goto(`/inventory?q=${run}-P`);
  await expect(page.getByText("1 package shown")).toBeVisible();
  await expect(page.getByText("25 g").first()).toBeVisible();

  // The same request sent twice makes one job, not two
  const unknownTemplate = await page.request.post("/api/labels/preview", { data: { templateId: "nope", sourceIds: [id] } });
  expect(unknownTemplate.status()).toBe(422);
  await page.goto(`/labels?kind=PACKAGE&ids=${id}`);
  const templateId = await page.getByLabel("Template").inputValue();
  const body = { templateId, sourceIds: [id], copies: 1, idempotencyKey: `${run}dupcheck` };
  const first = await (await page.request.post("/api/labels/jobs", { data: body })).json();
  const second = await (await page.request.post("/api/labels/jobs", { data: body })).json();
  expect(first.duplicate).toBe(false);
  expect(second.duplicate).toBe(true);
  expect(second.job.id).toBe(first.job.id);
});

test("records from another facility can't be labeled", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  await switchFacility(page, "Sandia Storefront");
  await page.goto("/inventory?q=CT-000102");
  const href = await page.getByRole("link", { name: "CT-000102" }).getAttribute("href");
  const shopPackage = href!.split("/").pop()!;

  // 9. From the grow, the storefront's package is treated as not found
  await switchFacility(page, "Rio Grande");
  await page.goto(`/labels?kind=PACKAGE&ids=${shopPackage}`);
  await page.getByRole("button", { name: "Check and preview" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("not found at this facility");
  const templateId = await page.getByLabel("Template").inputValue();
  const res = await page.request.post("/api/labels/jobs", { data: { templateId, sourceIds: [shopPackage], idempotencyKey: `${run}crossfac` } });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toContain("not found at this facility");
});

test("a misconfigured label is explained, blocked, and diagnosed", async ({ page }) => {
  await signIn(page, "inventory@demo.test");

  // A template with a barcode squeezed into 12 mm and a field that doesn't exist
  const created = await page.request.post("/api/labels/templates", {
    data: {
      name: `${run} squeezed`,
      kind: "PACKAGE",
      design: {
        widthMm: 50.8,
        heightMm: 25.4,
        elements: [
          { id: "b", type: "barcode", x: 1, y: 1, w: 12, h: 8, value: "{{package.tag}}", format: "code128" },
          { id: "t", type: "text", x: 1, y: 12, w: 40, h: 5, text: "{{item.secret}}", fontSize: 8 },
        ],
      },
    },
  });
  expect(created.status()).toBe(200);
  const { id } = await created.json();

  // 10. The designer explains what's wrong and how to fix it
  await page.goto(`/labels/templates/${id}`);
  const issues = page.getByTestId("label-issues");
  await expect(issues).toContainText("Can't print yet");
  await expect(issues).toContainText("too thin for label printers");
  await expect(issues).toContainText(/Widen the barcode to at least \d+ mm/);
  await expect(issues).toContainText("{{item.secret}} is not a field");

  // Printing with it is refused, and the refusal is logged as a failed job
  await page.goto("/inventory?q=CT-000007");
  const href = await page.getByRole("link", { name: "CT-000007" }).getAttribute("href");
  const pkg = href!.split("/").pop()!;
  const res = await page.request.post("/api/labels/jobs", { data: { templateId: id, sourceIds: [pkg], idempotencyKey: `${run}blocked` } });
  expect(res.status()).toBe(422);
  expect((await res.json()).issues.some((i: { code: string }) => i.code === "BARCODE_DENSE")).toBe(true);
  await page.goto("/labels/history");
  await expect(page.getByTestId("label-history").locator("tbody tr").first()).toContainText("Blocked by");

  // Tally runs the same checker and reports what blocks the state product label
  await page.goto("/labels/history");
  await page.getByRole("button", { name: "Ask Tally" }).click();
  const panel = page.getByRole("dialog", { name: /Tally/ });
  await panel.getByLabel("Message the assistant").fill("check product labels for CT-000003");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel).toContainText("can't print yet", { timeout: 15_000 });
  await expect(panel).toContainText("state logo spot has no image");
});

test("product labels pull in net weight in g and oz, the full cannabinoid profile, and the item's label details", async ({ page }) => {
  await signIn(page, "owner@demo.test");

  // Label details on the item
  await page.goto("/catalog");
  await page.locator("li", { hasText: "Blue Mesa Flower (bulk)" }).getByRole("link", { name: "Label details" }).click();
  await page.locator("textarea[name=\"directions\"]").fill("For inhalation. Light and inhale slowly.");
  await page.locator("input[name=\"pesticides\"]").fill("None");
  await page.locator("input[name=\"shelfLifeDays\"]").fill("365");
  await page.getByRole("button", { name: "Save label details" }).click();
  await expect(page.getByRole("status")).toContainText("Saved label details for Blue Mesa Flower (bulk)");

  // A 3.5 g package with a passed lab result and its cannabinoid profile
  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(`${run}-J`);
  await page.locator('select[name="itemId"]').selectOption({ label: "Blue Mesa Flower (bulk) (g)" });
  await page.locator('input[name="quantity"]').fill("3.5");
  await page.locator('select[name="locationId"]').selectOption({ label: "Dry Room" });
  await page.locator('input[name="lotNumber"]').fill("LOT-J");
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: `${run}-J` })).toBeVisible();
  const id = page.url().split("/").pop()!;
  await page.locator("summary", { hasText: "Add lab result" }).click();
  await page.locator('input[name="labName"]').fill("Scepter Labs");
  await page.locator('form:has(input[name="labName"]) select[name="status"]').selectOption("PASS");
  await page.locator('input[name="thcPercent"]').fill("20");
  await page.locator("summary", { hasText: "Full cannabinoid profile" }).click();
  await page.locator("input[name=\"thcaPercent\"]").fill("22.5");
  await page.locator("input[name=\"cbgPercent\"]").fill("1.1");
  await page.locator("input[name=\"terpenes\"]").fill("Myrcene 0.82%");
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByTestId("lab-profile")).toContainText("THCa 22.5% · CBG 1.1%");

  // The New Mexico flower label fills it all in
  await page.goto(`/labels?kind=PRODUCT&ids=${id}`);
  const flower = await page.getByLabel("Template").locator("option", { hasText: "NM product label 4×4 (flower)" }).getAttribute("value");
  await page.getByLabel("Template").selectOption(flower!);
  await page.getByRole("button", { name: "Check and preview" }).click();
  const previews = page.getByTestId("label-previews");
  await expect(previews).toContainText("3.5 g (0.12 oz)");
  await expect(previews).toContainText("700 mg per package");
  await expect(previews).toContainText("THCa 22.5%");
  await expect(previews).toContainText("Myrcene 0.82%");
  await expect(previews).toContainText("Pesticides: None");
  await expect(previews).toContainText("NM Poison & Drug Information Center 1-800-222-1222");
  await expect(previews).toContainText(/Expires \d{4}-\d{2}-\d{2}/);
});
