/**
 * Pure shaping of Leaf2Sale records into QuickBooks Online request bodies. No network, no database,
 * so it is fully testable. Amounts are strings with two decimals in Leaf2Sale; QuickBooks wants numbers.
 */

export type QbInvoiceInput = {
  number: string;
  total: string;
  dueDate: string; // YYYY-MM-DD
  issuedOn: string; // YYYY-MM-DD
  orderNumber?: string | null;
};
/** One shipped order line: item, quantity actually shipped, price per unit, and the line total Leaf2Sale billed. */
export type QbLineInput = { itemQbId: string; name: string; quantity: string; unitPrice: string; amount: string };
export type QbPaymentInput = { amount: string; method: string; reference: string | null; paidOn: string };
export type QbCustomerInput = { name: string; email: string | null; phone: string | null; contactName: string | null; address: string | null; licenseNumber: string };

const money = (v: string) => Math.round(Number(v) * 100) / 100;

/** QuickBooks display names must be unique and cannot contain a colon; they are capped at 100 characters. */
export function displayName(name: string): string {
  return name.replace(/[:\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Escape a value for use inside a QuickBooks query string literal. */
export const qbQuote = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function customerBody(c: QbCustomerInput): Record<string, unknown> {
  return {
    DisplayName: displayName(c.name),
    CompanyName: displayName(c.name),
    ...(c.contactName ? { GivenName: c.contactName.slice(0, 25) } : {}),
    ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}),
    ...(c.phone ? { PrimaryPhone: { FreeFormNumber: c.phone.slice(0, 21) } } : {}),
    ...(c.address ? { BillAddr: { Line1: c.address.slice(0, 500) } } : {}),
    Notes: `License ${c.licenseNumber}. Created by Leaf2Sale.`.slice(0, 2000),
  };
}

/**
 * The invoice. With lines, each shipped order line becomes its own QuickBooks line (its item decides the
 * income account). Without lines (older invoices, or lines that don't add up to the total), one line
 * for the whole amount against the fallback item, as before.
 */
export function invoiceBody(i: QbInvoiceInput, customerQbId: string, fallbackItemQbId: string, lines: QbLineInput[] = []): Record<string, unknown> {
  const itemized = lines.length > 0 && linesMatchTotal(lines, i.total);
  return {
    DocNumber: i.number.slice(0, 21),
    CustomerRef: { value: customerQbId },
    TxnDate: i.issuedOn,
    DueDate: i.dueDate,
    PrivateNote: `Leaf2Sale invoice ${i.number}${i.orderNumber ? `, order ${i.orderNumber}` : ""}`.slice(0, 4000),
    Line: itemized
      ? lines.map((l) => ({
          Amount: money(l.amount),
          DetailType: "SalesItemLineDetail",
          Description: l.name.slice(0, 4000),
          SalesItemLineDetail: { ItemRef: { value: l.itemQbId }, Qty: Number(l.quantity), UnitPrice: Number(l.unitPrice) },
        }))
      : [
          {
            Amount: money(i.total),
            DetailType: "SalesItemLineDetail",
            Description: i.orderNumber ? `Wholesale order ${i.orderNumber}` : `Invoice ${i.number}`,
            SalesItemLineDetail: { ItemRef: { value: fallbackItemQbId }, Qty: 1, UnitPrice: money(i.total) },
          },
        ],
  };
}

/** True when the lines add up to the invoice total to the cent, so QuickBooks shows the same amount owed. */
export function linesMatchTotal(lines: { amount: string }[], total: string): boolean {
  const cents = lines.reduce((sum, l) => sum + Math.round(Number(l.amount) * 100), 0);
  return cents === Math.round(Number(total) * 100);
}

/** A Leaf2Sale item as a QuickBooks non-inventory product whose sales post to the chosen income account. */
export function itemBody(it: { name: string; sku: string }, incomeAccountId: string): Record<string, unknown> {
  return {
    Name: displayName(it.name),
    Type: "NonInventory",
    ...(it.sku ? { Sku: it.sku.slice(0, 100) } : {}),
    IncomeAccountRef: { value: incomeAccountId },
  };
}

/** Which income account a category posts to: its own choice, else the default, else null (QuickBooks' first income account). */
export function accountFor(categoryId: string | null, map: Map<string, string>): string | null {
  return (categoryId ? map.get(categoryId) : undefined) ?? map.get("*") ?? null;
}

export function paymentBody(p: QbPaymentInput, customerQbId: string, invoiceQbId: string): Record<string, unknown> {
  const amount = money(p.amount);
  return {
    CustomerRef: { value: customerQbId },
    TotalAmt: amount,
    TxnDate: p.paidOn,
    ...(p.reference ? { PaymentRefNum: p.reference.slice(0, 21) } : {}),
    PrivateNote: `Leaf2Sale payment (${p.method.toLowerCase().replace(/_/g, " ")})`,
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: invoiceQbId, TxnType: "Invoice" }] }],
  };
}
