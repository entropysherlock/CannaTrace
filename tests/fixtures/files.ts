import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";

/** Sample files with made-up data, generated on the fly so nothing real is ever checked in. */

export const png = (w = 800, h = 600) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 120, b: 60, alpha: 1 } } }).png().toBuffer();
export const jpgWithGps = () =>
  sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "FakeCam", Model: "Test 1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "35/1 5/1 0/1" } })
    .toBuffer();
export const webp = () => sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 10, g: 10, b: 10 } } }).webp().toBuffer();

export async function pdf(pages = 2, text = "Certificate of Analysis - Sample Lab (fictional)") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`${text} - page ${i + 1}`, { x: 50, y: 700, size: 14, font });
  return Buffer.from(await doc.save());
}

export async function xlsx() {
  const book = new ExcelJS.Workbook();
  const s = book.addWorksheet("Counts");
  s.addRow(["Tag", "Item", "Quantity", "UoM", "Counted"]);
  s.addRow(["FAKE-0001", "Sample Jar", 12.5, "Each", new Date(Date.UTC(2026, 10, 3))]);
  s.addRow(["FAKE-0002", "Sample Flower", 3.14159265358979, "Grams", { formula: "1+1", result: 2 }]);
  const hidden = book.addWorksheet("Notes", { state: "hidden" });
  hidden.addRow(["Note"]);
  hidden.addRow(["Made-up data"]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** A minimal Word file: a heading, a paragraph, a picture placeholder, and a two-column table. */
export async function docx(body = "Labels must show the THC content (fictional rule).") {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const p = (t: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const cell = (t: string) => `<w:tc>${p(t)}</w:tc>`;
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p("Packaging Rules", "Heading1")}${p(body)}<w:tbl><w:tr>${cell("Field")}${cell("Required")}</w:tr><w:tr>${cell("THC %")}${cell("Yes")}</w:tr></w:tbl></w:body></w:document>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

export const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"));
