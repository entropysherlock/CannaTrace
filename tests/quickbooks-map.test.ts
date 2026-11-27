/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { accountFor, customerBody, displayName, invoiceBody, itemBody, linesMatchTotal, paymentBody, qbQuote } from "@/lib/quickbooks-map";

describe("QuickBooks shaping", () => {
  it("cleans display names: no colons, one line, 100 characters", () => {
    expect(displayName("  Desert: Leaf \n Dispensary ")).toBe("Desert Leaf Dispensary");
    expect(displayName("x".repeat(150))).toHaveLength(100);
  });
  it("escapes quotes in query values", () => {
    expect(qbQuote("O'Brien's")).toBe("'O\\'Brien\\'s'");
  });
  it("builds an invoice with a number, dates and one sales line", () => {
    const b = invoiceBody({ number: "INV-0007", total: "1250.50", dueDate: "2026-12-15", issuedOn: "2026-11-15", orderNumber: "SO-12" }, "55", "9") as { [k: string]: any };
    expect(b.DocNumber).toBe("INV-0007");
    expect(b.CustomerRef).toEqual({ value: "55" });
    expect(b.DueDate).toBe("2026-12-15");
    expect(b.Line[0].Amount).toBe(1250.5);
    expect(b.Line[0].SalesItemLineDetail.ItemRef).toEqual({ value: "9" });
  });
  it("applies a payment to its invoice", () => {
    const b = paymentBody({ amount: "400.00", method: "CHECK", reference: "1042", paidOn: "2026-11-20" }, "55", "301") as { [k: string]: any };
    expect(b.TotalAmt).toBe(400);
    expect(b.PaymentRefNum).toBe("1042");
    expect(b.Line[0].LinkedTxn).toEqual([{ TxnId: "301", TxnType: "Invoice" }]);
  });
  it("leaves out contact details that are missing", () => {
    const b = customerBody({ name: "Mesa Farms", email: null, phone: null, contactName: null, address: null, licenseNumber: "MV-1" });
    expect(b).not.toHaveProperty("PrimaryEmailAddr");
    expect(b.DisplayName).toBe("Mesa Farms");
  });

  it("itemizes an invoice one line per shipped item when the lines add up to the total", () => {
    const lines = [
      { itemQbId: "11", name: "Blue Mesa 3.5 g Jar", quantity: "40", unitPrice: "12.5", amount: "500.00" },
      { itemQbId: "12", name: "Desert Haze 1 g Pre-roll", quantity: "100", unitPrice: "3.333", amount: "333.30" },
    ];
    const b = invoiceBody({ number: "INV-0008", total: "833.30", dueDate: "2026-12-15", issuedOn: "2026-11-15", orderNumber: "SO-13" }, "55", "9", lines) as { [k: string]: any };
    expect(b.Line).toHaveLength(2);
    expect(b.Line[0]).toMatchObject({ Amount: 500, Description: "Blue Mesa 3.5 g Jar", SalesItemLineDetail: { ItemRef: { value: "11" }, Qty: 40, UnitPrice: 12.5 } });
    expect(b.Line[1].Amount).toBe(333.3);
  });

  it("falls back to one line when the shipped lines don't match the invoice total", () => {
    const lines = [{ itemQbId: "11", name: "Blue Mesa 3.5 g Jar", quantity: "40", unitPrice: "12.5", amount: "500.00" }];
    const b = invoiceBody({ number: "INV-0009", total: "450.00", dueDate: "2026-12-15", issuedOn: "2026-11-15" }, "55", "9", lines) as { [k: string]: any };
    expect(b.Line).toHaveLength(1);
    expect(b.Line[0]).toMatchObject({ Amount: 450, SalesItemLineDetail: { ItemRef: { value: "9" } } });
  });

  it("checks line totals to the cent", () => {
    expect(linesMatchTotal([{ amount: "0.10" }, { amount: "0.20" }], "0.30")).toBe(true);
    expect(linesMatchTotal([{ amount: "0.10" }], "0.11")).toBe(false);
  });

  it("makes a non-inventory product posting to the chosen income account", () => {
    expect(itemBody({ name: "Flower: Blue Mesa", sku: "BM-35" }, "79")).toEqual({ Name: "Flower Blue Mesa", Type: "NonInventory", Sku: "BM-35", IncomeAccountRef: { value: "79" } });
  });

  it("picks the category's account, then the default, then none", () => {
    const map = new Map([["cat-flower", "80"], ["*", "70"]]);
    expect(accountFor("cat-flower", map)).toBe("80");
    expect(accountFor("cat-edibles", map)).toBe("70");
    expect(accountFor("cat-edibles", new Map())).toBeNull();
  });
});
