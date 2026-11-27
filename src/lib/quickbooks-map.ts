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

export function invoiceBody(i: QbInvoiceInput, customerQbId: string, itemQbId: string): Record<string, unknown> {
  return {
    DocNumber: i.number.slice(0, 21),
    CustomerRef: { value: customerQbId },
    TxnDate: i.issuedOn,
    DueDate: i.dueDate,
    PrivateNote: `Leaf2Sale invoice ${i.number}${i.orderNumber ? `, order ${i.orderNumber}` : ""}`.slice(0, 4000),
    Line: [
      {
        Amount: money(i.total),
        DetailType: "SalesItemLineDetail",
        Description: i.orderNumber ? `Wholesale order ${i.orderNumber}` : `Invoice ${i.number}`,
        SalesItemLineDetail: { ItemRef: { value: itemQbId }, Qty: 1, UnitPrice: money(i.total) },
      },
    ],
  };
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
