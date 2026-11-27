/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { customerBody, displayName, invoiceBody, paymentBody, qbQuote } from "@/lib/quickbooks-map";

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
});
