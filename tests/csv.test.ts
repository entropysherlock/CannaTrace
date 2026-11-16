import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, csvCell, parseCsv, readTable, toCsv } from "../src/lib/csv";
import { InventoryError } from "../src/lib/inventory-math";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and new lines inside quotes", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
  });
  it("ignores a byte-order mark, blank lines, and a missing final newline", () => {
    expect(parseCsv("﻿name\n\nBlue\n")).toEqual([["name"], ["Blue"]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps empty fields", () => {
    expect(parseCsv("a,,c\n,,\n1,,")).toEqual([["a", "", "c"], ["1", "", ""]]);
  });
  it("reports an unclosed quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/never closed/);
  });
});

describe("readTable", () => {
  it("matches headers loosely and reports line numbers", () => {
    const rows = readTable("Name, SKU ,unit_of_measure\nBlue,B1,G\n", ["name", "sku", "unitOfMeasure"]);
    expect(rows).toEqual([{ line: 2, values: { name: "Blue", sku: "B1", unitOfMeasure: "G" } }]);
  });
  it("says which columns are missing", () => {
    expect(() => readTable("name\nx", ["name", "sku"])).toThrow(/Missing: sku/);
  });
  it("refuses an empty file and huge files", () => {
    expect(() => readTable("", ["name"])).toThrow(InventoryError);
    expect(() => readTable("name\n" + "x\n".repeat(MAX_IMPORT_ROWS + 1), ["name"])).toThrow(/at most/);
  });
});

describe("export", () => {
  it("quotes what needs quoting", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell(null)).toBe("");
  });
  it("defuses spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-1.5")).toBe("-1.5");
    expect(csvCell("-cmd")).toBe("'-cmd");
  });
  it("round-trips through the parser", () => {
    const text = toCsv(["tag", "note"], [["CT-1", 'has "quotes", commas\nand lines']]);
    expect(parseCsv(text)).toEqual([["tag", "note"], ["CT-1", 'has "quotes", commas\nand lines']]);
  });
});
