import { describe, expect, it } from "vitest";
import { cleanNumber, proposeDocument } from "@/lib/scan/doc-math";
import { DOCS } from "@/lib/scan/documents";
import type { DocProposal } from "@/lib/scan/types";

const doc = (raw: Record<string, unknown>, today = "2026-11-20") => proposeDocument(raw, today) as DocProposal;

describe("numbers", () => {
  it("cleans money and rejects text", () => {
    expect(cleanNumber("$1,234.50")).toBe("1234.5");
    expect(cleanNumber("(12.00)")).toBe("-12");
    expect(cleanNumber(7)).toBe("7");
    expect(cleanNumber("ND")).toBeNull();
  });
});

describe("recognising documents", () => {
  it("knows every kind it lists, and keeps unknowns out of forms", () => {
    for (const d of DOCS) expect(proposeDocument({ document_type: d.type }, "2026-11-20").kind).toBe("DOC");
    expect(proposeDocument({ document_type: "OTHER", notes: "A postcard." }, "2026-11-20")).toEqual({ kind: "OTHER", summary: "A postcard." });
    expect(proposeDocument({ document_type: "SPACESHIP" }, "2026-11-20").kind).toBe("OTHER");
  });

  it("never carries anything from a customer ID", () => {
    const p = doc({ document_type: "SENSITIVE_ID", summary: "Jane Doe 12345", fields: { holder: "Jane Doe" }, items: [{ a: "b" }] });
    expect(p.fields).toEqual([]);
    expect(p.items).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("Jane");
  });

  it("only keeps the keys it asked for, and marks what is missing or uncertain", () => {
    const p = doc({ document_type: "MANIFEST", fields: { manifestNumber: "M-1", shipDate: "2026-02-30", evil: "x" }, uncertain_fields: ["manifestNumber"] });
    const by = Object.fromEntries(p.fields.map((f) => [f.key, f]));
    expect(by.evil).toBeUndefined();
    expect(by.manifestNumber.confidence).toBe("check");
    expect(by.shipDate.confidence).toBe("check"); // February 30th is not a date
    expect(by.sender.confidence).toBe("missing");
    expect(p.warnings.join(" ")).toContain("Ship date");
  });
});

describe("checks", () => {
  it("catches lines that don't multiply and totals that don't add up", () => {
    const p = doc({
      document_type: "INVOICE",
      fields: { subtotal: "$120.00", total: "$129.00", tax: "$9.00" },
      items: [
        { description: "Bags", quantity: 100, unitPrice: "$0.80", lineTotal: "$80.00" },
        { description: "Labels", quantity: 100, unitPrice: "$0.50", lineTotal: "$45.00" },
      ],
    });
    expect(p.warnings.join(" ")).toContain("line 2");
    expect(p.warnings.join(" ")).toContain("add up to 125.00");
  });

  it("is quiet when an invoice is right", () => {
    const p = doc({ document_type: "INVOICE", fields: { subtotal: "125", tax: "9", total: "134" }, items: [{ quantity: 5, unitPrice: 25, lineTotal: 125 }] });
    expect(p.warnings).toEqual([]);
  });

  it("flags repeated tags and harvest weights that disagree", () => {
    const m = doc({ document_type: "MANIFEST", items: [{ packageTag: "ab1" }, { packageTag: "AB1" }] });
    expect(m.warnings.join(" ")).toContain("AB1 appears more than once");
    const h = doc({ document_type: "HARVEST_SHEET", fields: { totalWetWeight: 500 }, items: [{ plantTag: "P1", wetWeight: 200, unit: "g" }, { plantTag: "P2", wetWeight: 250, unit: "g" }] });
    expect(h.warnings.join(" ")).toContain("add up to 450");
  });

  it("warns about licenses and notices by the store's date", () => {
    expect(doc({ document_type: "LICENSE", fields: { expiryDate: "2026-11-10" } }).warnings.join(" ")).toContain("expired 10 days ago");
    expect(doc({ document_type: "LICENSE", fields: { expiryDate: "2026-12-01" } }).warnings.join(" ")).toContain("expires in 11 days");
    expect(doc({ document_type: "LICENSE", fields: { expiryDate: "2028-01-01" } }).warnings).toEqual([]);
    expect(doc({ document_type: "STATE_NOTICE", fields: { deadline: "2026-11-25" } }).warnings.join(" ")).toContain("in 5 days");
  });

  it("asks for a reason on a destruction record", () => {
    expect(doc({ document_type: "WASTE_RECORD", fields: { witness: "A" } }).warnings.join(" ")).toContain("No reason");
  });
});
