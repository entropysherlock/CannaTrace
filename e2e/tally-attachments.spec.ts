import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import * as fx from "../tests/fixtures/files";

const png = (color: number) => sharp({ create: { width: 640, height: 400, channels: 3, background: { r: color, g: 120, b: 60 } } }).png().toBuffer();
async function pdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText("Certificate of Analysis (fictional) - THC 21.4%", { x: 50, y: 700, size: 14, font });
  return Buffer.from(await doc.save());
}

test("an employee attaches images, a PDF, and a spreadsheet to Tally, and the files reach the model", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("inventory@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.keyboard.press("Control+j");
  const panel = page.getByRole("dialog", { name: /CannaTrace assistant/ });

  // The + menu, with the disclosure about where files go
  await panel.getByRole("button", { name: "Attach files" }).click();
  const menu = panel.getByRole("menu", { name: "Attach" });
  for (const item of ["Upload image", "Upload PDF", "Upload spreadsheet", "Upload document"]) await expect(menu.getByRole("menuitem", { name: new RegExp(item) })).toBeVisible();
  await expect(menu).toContainText("sent to Anthropic's Claude to be read");
  const chooser = page.waitForEvent("filechooser");
  await menu.getByRole("menuitem", { name: /Upload image/ }).click();
  await (await chooser).setFiles({ name: "label.png", mimeType: "image/png", buffer: await png(30) });

  // Several more at once, through the other pickers
  await panel.locator("[data-attach-input=pdf]").setInputFiles({ name: "coa.pdf", mimeType: "application/pdf", buffer: await pdf() });
  await panel.locator("[data-attach-input=sheet]").setInputFiles({ name: "count.csv", mimeType: "text/csv", buffer: Buffer.from("Tag,Quantity\nCT-000007,999\n") });

  // Unsupported and oversized files are refused on the spot, and can be removed
  await panel.locator("[data-attach-input=doc]").setInputFiles([
    { name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
    { name: "huge.txt", mimeType: "text/plain", buffer: Buffer.alloc(3 * 1024 * 1024, 97) },
  ]);
  await expect(panel.locator("[data-attachment-chip=error]", { hasText: "virus.exe" })).toContainText("Tally can read PNG, JPG, WEBP, PDF, DOCX, TXT, CSV, and XLSX files.");
  await expect(panel.locator("[data-attachment-chip=error]", { hasText: "huge.txt" })).toContainText("Too large (3.0 MB). The limit for this kind of file is 2.0 MB.");
  await panel.getByRole("button", { name: "Remove virus.exe" }).click();
  await panel.getByRole("button", { name: "Remove huge.txt" }).click();
  await expect(panel.locator("[data-attachment-chip=error]")).toHaveCount(0);

  // A pasted screenshot, and a dragged-in file
  const shot = (await png(200)).toString("base64");
  await panel.getByLabel("Message the assistant").evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "image.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, shot);
  await panel.evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(["Receiving notes (fictional): 12 cases arrived."], "notes.txt", { type: "text/plain" }));
    el.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await expect(panel.locator("[data-attachment-chip=ready]")).toHaveCount(5, { timeout: 20_000 });
  await expect(panel.locator("[data-attachment-chip=ready]", { hasText: "coa.pdf" })).toContainText("1 page");
  await expect(panel.locator("[data-attachment-chip=ready]", { hasText: "count.csv" })).toContainText("1 rows");
  await expect(panel.locator("[data-attachment-chip=ready]", { hasText: /screenshot-.*\.png/ })).toBeVisible();

  // Send: every file reaches the model, in the right form
  await panel.getByLabel("Message the assistant").fill("What do you see?");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.locator("[data-sent-file]")).toHaveCount(5);
  await expect(panel.getByText('I received 5 files: image (image/png), document "coa.pdf" (application/pdf), spreadsheet preview, image (image/png), document "notes.txt" (text/plain).')).toBeVisible();
  await expect(panel.locator("[data-attachment-chip]")).toHaveCount(0);

  // A spreadsheet compared with live inventory, read-only
  await panel.locator("[data-attach-input=sheet]").setInputFiles({ name: "recount.csv", mimeType: "text/csv", buffer: Buffer.from("Tag,Quantity\nCT-000007,999\nNOT-A-REAL-TAG,1\n") });
  await expect(panel.locator("[data-attachment-chip=ready]")).toHaveCount(1);
  await panel.getByLabel("Message the assistant").fill("compare this with inventory");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByText(/Compared recount\.csv: \d+ match, 1 differ, 1 not in CannaTrace\. Nothing was changed\./)).toBeVisible();

  // The other formats through the same path: Excel, Word, JPG (with camera data), and WEBP
  await panel.locator("[data-attach-input=sheet]").setInputFiles({ name: "counts.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await fx.xlsx() });
  await panel.locator("[data-attach-input=doc]").setInputFiles({ name: "rules.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await fx.docx() });
  await panel.locator("[data-attach-input=image]").setInputFiles([
    { name: "photo.jpg", mimeType: "image/jpeg", buffer: await fx.jpgWithGps() },
    { name: "screen.webp", mimeType: "image/webp", buffer: await fx.webp() },
  ]);
  await expect(panel.locator("[data-attachment-chip=ready]")).toHaveCount(4, { timeout: 20_000 });
  await expect(panel.locator("[data-attachment-chip=ready]", { hasText: "counts.xlsx" })).toContainText("3 rows");
  await panel.getByLabel("Message the assistant").fill("And these?");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByText('I received 4 files: spreadsheet preview, document "rules.docx" (text/plain), image (image/jpeg), image (image/jpeg).')).toBeVisible();
});
