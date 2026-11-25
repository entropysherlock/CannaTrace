import bcrypt from "bcryptjs";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLogs,
  drawerSessions,
  facilities,
  inventoryTransactions,
  invoices,
  itemCategories,
  items,
  locations,
  organizations,
  packages,
  passwordResets,
  payments,
  saleReturns,
  sales,
  syncEvents,
  users,
} from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { createCustomer, createOrder, issueCreditMemo, recordPayment } from "@/lib/distribution";
import { addLabResult, receivePackage, type Actor } from "@/lib/inventory";
import { loadLabelRecords } from "@/lib/labels/data";
import {
  addToCart,
  checkInCustomer,
  closeDrawer,
  completeSale,
  customerKeyFor,
  drawerSummary,
  getRetailSettings,
  openDrawer,
  returnableLines,
  returnSale,
  saveRetailSettings,
  setMenuItem,
  voidSale,
} from "@/lib/pos";
import { permissionsFor, type Role } from "@/lib/rbac";
import { sessionFromToken, type Session } from "@/lib/session";
import { changeOwnPassword, completeReset, createPasswordReset, lookupReset, setUserActive } from "@/lib/team";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `B8${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
const adult = { birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE" };
const cookie = (s: { userId: string; orgId: string; facilityId: string; role: Role; name: string }, iat: number) =>
  new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(process.env.AUTH_SECRET));

describe.skipIf(!hasDb)("password reset, deactivation, daily limits, warnings, returns, and credit memos (database)", () => {
  let actor: Actor;
  let owner: Session;
  let manager: Session;
  let member: { id: string; email: string; name: string };
  let ownerTwo: { id: string };
  let jar: string;
  let gummies: string;
  let shelf: string;
  let n = 0;
  const tag = () => `${run}-${String(++n).padStart(4, "0")}`;
  const sess = (u: { id: string; name: string }, role: Role, org: string, fac: string): Session => ({
    userId: u.id,
    orgId: org,
    facilityId: fac,
    name: u.name,
    role,
    permissions: permissionsFor(role),
    roleName: role,
    customRoleId: null,
  });
  async function stock(itemId: string, quantity: string) {
    const pkg = await receivePackage(actor, { tag: tag(), itemId, quantity, locationId: shelf });
    await addLabResult(actor, { packageId: pkg.id, labName: "Test Lab", status: "PASS", thcPercent: "20" });
    return pkg;
  }
  async function sell(idNumber: string | undefined, lines: [string, string][], method: "CASH" | "DEBIT" = "CASH") {
    const cart = await checkInCustomer(actor, { ...adult, idNumber });
    for (const [itemId, quantity] of lines) await addToCart(actor, { saleId: cart.id, itemId, quantity });
    await completeSale(actor, { saleId: cart.id, paymentMethod: method, cashTendered: method === "CASH" ? "500" : undefined });
    return cart.id;
  }

  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Batch ${run}` }).returning();
    const [fac] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-S`, licenseType: "RETAIL", state: "NM" }).returning();
    const hash = await bcrypt.hash("old-password-123", 4);
    const [o1, o2, m, mem] = await db
      .insert(users)
      .values([
        { orgId: org.id, name: "Olive Owner", email: `o1-${run}@t.invalid`, passwordHash: hash, role: "OWNER" },
        { orgId: org.id, name: "Otto Owner", email: `o2-${run}@t.invalid`, passwordHash: hash, role: "OWNER" },
        { orgId: org.id, name: "Mona Manager", email: `m-${run}@t.invalid`, passwordHash: hash, role: "MANAGER" },
        { orgId: org.id, name: "Bea Budtender", email: `b-${run}@t.invalid`, passwordHash: hash, role: "BUDTENDER" },
      ])
      .returning();
    owner = sess(o1, "OWNER", org.id, fac.id);
    manager = sess(m, "MANAGER", org.id, fac.id);
    member = mem;
    ownerTwo = o2;
    actor = { userId: m.id, userName: m.name, orgId: org.id, facilityId: fac.id };
    const [loc] = await db.insert(locations).values({ orgId: org.id, facilityId: fac.id, name: "Floor", type: "ROOM" }).returning();
    shelf = loc.id;
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db
      .insert(items)
      .values(["Jar 3.5", "Gummies 100mg"].map((name, i) => ({ orgId: org.id, name, sku: `${run}${i}`, categoryId: cat.id, unit: "EACH" as const })))
      .returning();
    [jar, gummies] = made.map((x) => x.id);
    await saveRetailSettings(actor, { flowerLimitGrams: "7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "8", medicalTaxExempt: true, dailyLimits: true });
    await setMenuItem(actor, { itemId: jar, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    await setMenuItem(actor, { itemId: gummies, price: "10", limitCategory: "EDIBLE", limitPerUnit: "100" });
    await stock(jar, "40");
    await stock(gummies, "40");
    await openDrawer(actor, { openingCash: "300" });
  });
  afterAll(() => pool.end());

  describe("passwords", () => {
    it("an owner makes a one-time reset link; it sets a new password once and signs out the old sign-ins", async () => {
      const before = await sessionFromToken(await cookie({ userId: member.id, orgId: owner.orgId, facilityId: owner.facilityId, role: "BUDTENDER", name: member.name }, Math.floor(Date.now() / 1000) - 60));
      expect(before?.name).toBe("Bea Budtender");

      const first = await createPasswordReset(owner, member.id);
      const link = await createPasswordReset(owner, member.id);
      await expect(lookupReset(first.token)).rejects.toThrow(/expired or was already used/); // only the newest link works
      expect(await lookupReset(link.token)).toEqual({ name: "Bea Budtender", email: member.email });
      await expect(completeReset(link.token, "short")).rejects.toThrow(/at least 12 characters/);
      await new Promise((r) => setTimeout(r, 1100));
      expect(await completeReset(link.token, "a-brand-new-password")).toEqual({ email: member.email });
      await expect(completeReset(link.token, "another-new-password")).rejects.toThrow(/expired or was already used/);

      const [u] = await db.select().from(users).where(eq(users.id, member.id));
      expect(await bcrypt.compare("a-brand-new-password", u.passwordHash)).toBe(true);
      // The sign-in from before the reset no longer works; a new one does.
      expect(await sessionFromToken(await cookie({ userId: member.id, orgId: owner.orgId, facilityId: owner.facilityId, role: "BUDTENDER", name: member.name }, Math.floor(Date.now() / 1000) - 60))).toBeNull();
      expect(await sessionFromToken(await cookie({ userId: member.id, orgId: owner.orgId, facilityId: owner.facilityId, role: "BUDTENDER", name: member.name }, Math.floor(Date.now() / 1000)))).not.toBeNull();
      const logged = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, member.id), eq(auditLogs.action, "PASSWORD_RESET")));
      expect(logged).toHaveLength(1);
      // Only a hash of the link is stored.
      expect((await db.select().from(passwordResets).where(eq(passwordResets.userId, member.id))).every((r) => r.tokenHash !== link.token && r.tokenHash.length === 64)).toBe(true);
    });

    it("follows the same rules as changing someone's access, and links expire", async () => {
      // Built-in managers don't manage the team; owners do. Nobody resets their own this way.
      await expect(createPasswordReset(manager, member.id)).rejects.toThrow(/does not allow managing the team/);
      await expect(createPasswordReset(owner, owner.userId)).rejects.toThrow(/cannot change your own/);
      // A custom role that manages the team still can't reset an owner's password.
      const lead = { ...manager, permissions: [...manager.permissions, "users.manage" as const], customRoleId: "lead" };
      await expect(createPasswordReset(lead, ownerTwo.id)).rejects.toThrow(/Only an owner/);
      const link = await createPasswordReset(owner, ownerTwo.id);
      await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResets.userId, ownerTwo.id));
      await expect(lookupReset(link.token)).rejects.toThrow(/expired/);
      await expect(lookupReset("not-a-real-token-at-all-xx")).rejects.toThrow(/expired|isn't valid/);
    });

    it("changing your own password needs the current one and signs out other devices", async () => {
      await expect(changeOwnPassword(manager, { current: "wrong-password-xx", next: "managers-new-password" })).rejects.toThrow(/current password isn't right/);
      await expect(changeOwnPassword(manager, { current: "old-password-123", next: "old-password-123" })).rejects.toThrow(/different/);
      const old = await cookie({ userId: manager.userId, orgId: manager.orgId, facilityId: manager.facilityId, role: "MANAGER", name: manager.name }, Math.floor(Date.now() / 1000) - 120);
      await changeOwnPassword(manager, { current: "old-password-123", next: "managers-new-password" });
      expect(await sessionFromToken(old)).toBeNull();
    });

    it("deactivating someone signs them out at once and refuses their reset links; reactivating lets them back", async () => {
      const token = await cookie({ userId: member.id, orgId: owner.orgId, facilityId: owner.facilityId, role: "BUDTENDER", name: member.name }, Math.floor(Date.now() / 1000) + 5);
      const link = await createPasswordReset(owner, member.id);
      await setUserActive(owner, member.id, false);
      expect(await sessionFromToken(token)).toBeNull();
      await expect(lookupReset(link.token)).rejects.toThrow(/expired or was already used/);
      await expect(createPasswordReset(owner, member.id)).rejects.toThrow(/is deactivated/);
      await setUserActive(owner, member.id, true);
      expect(await sessionFromToken(token)).not.toBeNull();
    });
  });

  describe("per-customer daily purchase limits", () => {
    it("asks for the ID number, then counts today's earlier purchases by the same ID however it's typed", async () => {
      await expect(checkInCustomer(actor, adult)).rejects.toThrow(/counts purchase limits per customer per day/);
      const first = await sell("NM-123 456", [[jar, "1"]]);
      const key = (await db.select().from(sales).where(eq(sales.id, first)))[0].customerKey!;
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain("123456");

      const cart = await checkInCustomer(actor, { ...adult, idNumber: "nm123456" });
      await expect(addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "2" })).rejects.toThrow(
        "This customer already bought 3.5 g of flower earlier today. With this cart that's 10.5 g, over the daily limit of 7 g.",
      );
      await addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "1" });
      await completeSale(actor, { saleId: cart.id, paymentMethod: "DEBIT" });
      // A different person isn't affected.
      await expect(sell("ZZ-999 888", [[jar, "2"]])).resolves.toBeDefined();
      // The same ID gives a different code at another business.
      expect(customerKeyFor("some-other-org", "NM-123 456")).not.toBe(key);
      expect(() => customerKeyFor(actor.orgId, "12")).toThrow(/full number/);
    });

    it("a voided sale no longer counts toward the day", async () => {
      const id = await sell("VOID-0001", [[jar, "2"]]);
      await voidSale(actor, { saleId: id, reason: "rang up wrong" });
      await expect(sell("VOID-0001", [[jar, "2"]])).resolves.toBeDefined();
    });
  });

  describe("warnings on receipts and labels", () => {
    it("saves the store's wording and puts the label wording in a label field", async () => {
      await expect(saveRetailSettings(actor, { flowerLimitGrams: "7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "8", medicalTaxExempt: true, receiptWarning: "x".repeat(1501) })).rejects.toThrow(/too long/);
      await saveRetailSettings(actor, {
        flowerLimitGrams: "7",
        concentrateLimitGrams: "16",
        edibleLimitMg: "800",
        exciseTaxPercent: "12",
        salesTaxPercent: "8",
        medicalTaxExempt: true,
        receiptWarning: "  Keep out of reach of children (fictional store wording).\r\n  ",
        labelWarning: "For use only by adults 21 and older (fictional).",
      });
      const s = await getRetailSettings(db, actor.facilityId);
      expect(s).toMatchObject({ receiptWarning: "Keep out of reach of children (fictional store wording).", labelWarning: "For use only by adults 21 and older (fictional).", dailyLimits: true });
      const pkg = (await db.select().from(packages).where(eq(packages.itemId, jar)))[0];
      const [record] = await loadLabelRecords(actor, "PACKAGE", [pkg.id]);
      expect(record.values["store.warning"]).toBe("For use only by adults 21 and older (fictional).");
    });
  });

  describe("returns", () => {
    it("takes back part of a sale on any day, refunds the right share, and balances the drawer", async () => {
      const saleId = await sell("RET-0001", [[jar, "2"]]);
      const [sold] = await db.select().from(sales).where(eq(sales.id, saleId));
      const [line] = await returnableLines(db, saleId);
      const pkg = (await db.select().from(packages).where(eq(packages.itemId, jar)))[0];
      const before = new Decimal(pkg.quantity);
      const [drawer] = await db.select().from(drawerSessions).where(and(eq(drawerSessions.facilityId, actor.facilityId), eq(drawerSessions.status, "OPEN")));
      const cashBefore = (await drawerSummary(db, drawer)).expectedCash;

      await expect(returnSale(actor, { saleId, lines: [{ saleLineId: line.saleLineId, quantity: "3" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "changed mind" })).rejects.toThrow(/Only 2 of Jar 3.5 can still be returned/);
      await expect(returnSale(actor, { saleId, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "" })).rejects.toThrow(/Say why/);
      const half = await returnSale(actor, { saleId, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "changed mind" });
      expect(half.number).toMatch(/^R-\d{5}$/);
      expect(half.amount).toBe(new Decimal(sold.total!).div(2).toFixed(2));
      expect(new Decimal((await db.select().from(packages).where(eq(packages.id, pkg.id)))[0].quantity).toString()).toBe(before.add(1).toString());
      const cashAfter = (await drawerSummary(db, drawer)).expectedCash;
      expect(cashBefore.sub(cashAfter).toFixed(2)).toBe(half.amount);

      // The rest comes back opened: written off, and the refund is exactly what's left, to the penny.
      const rest = await returnSale(actor, { saleId, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CASH", disposition: "DISPOSE", reason: "opened, smelled off" });
      expect(new Decimal(half.amount).add(rest.amount).toFixed(2)).toBe(new Decimal(sold.total!).toFixed(2));
      expect(new Decimal((await db.select().from(packages).where(eq(packages.id, pkg.id)))[0].quantity).toString()).toBe(before.add(1).toString());
      const ledger = await db.select().from(inventoryTransactions).where(eq(inventoryTransactions.packageId, pkg.id));
      expect(ledger.some((t) => t.type === "ADJUST" && t.reasonCode === "DAMAGE" && t.note?.includes(rest.number))).toBe(true);
      expect((await returnableLines(db, saleId))[0].returnable).toBe("0");
      await expect(returnSale(actor, { saleId, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "again" })).rejects.toThrow(/Only 0/);
      expect(await db.$count(syncEvents, and(eq(syncEvents.facilityId, actor.facilityId), eq(syncEvents.type, "RETAIL_SALE_RETURNED")))).toBe(2);
    });

    it("refunds a split sale back the way it was paid: cash from the drawer and the rest to the card (APEX-41)", async () => {
      const cart = await checkInCustomer(actor, { ...adult, idNumber: "RET-SPLIT" });
      await addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "2" });
      const paid = await completeSale(actor, { saleId: cart.id, paymentMethod: "SPLIT", debitAmount: "30", cashTendered: "200" });
      const [line] = await returnableLines(db, cart.id);
      const total = new Decimal(paid.total);
      const cashPaid = total.sub(30);
      const [drawer] = await db.select().from(drawerSessions).where(and(eq(drawerSessions.facilityId, actor.facilityId), eq(drawerSessions.status, "OPEN")));
      const cashBefore = (await drawerSummary(db, drawer)).expectedCash;
      // Cash only or card only is refused on a split sale.
      await expect(returnSale(actor, { saleId: cart.id, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "cash only" })).rejects.toThrow(/part cash and part debit/);
      await expect(returnSale(actor, { saleId: cart.id, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CARD", disposition: "RESTOCK", reason: "card only" })).rejects.toThrow(/part cash and part debit/);
      const half = await returnSale(actor, { saleId: cart.id, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "SPLIT", disposition: "RESTOCK", reason: "half" });
      const rest = await returnSale(actor, { saleId: cart.id, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "SPLIT", disposition: "RESTOCK", reason: "rest" });
      expect(new Decimal(half.amount).add(rest.amount).toFixed(2)).toBe(total.toFixed(2));
      const rows = await db.select().from(saleReturns).where(eq(saleReturns.saleId, cart.id));
      const cashBack = rows.reduce((acc, r) => acc.add(r.cashAmount ?? 0), new Decimal(0));
      // Exactly the cash that was paid comes out of the drawer, and no more, so the card side gets the debit share.
      expect(cashBack.toFixed(2)).toBe(cashPaid.toFixed(2));
      expect(cashBefore.sub((await drawerSummary(db, drawer)).expectedCash).toFixed(2)).toBe(cashPaid.toFixed(2));
    });

    it("works after the shift closed: card refunds anytime, cash only from an open drawer", async () => {
      const saleId = await sell("RET-0002", [[gummies, "3"]], "DEBIT");
      const [line] = await returnableLines(db, saleId);
      const [drawer] = await db.select().from(drawerSessions).where(and(eq(drawerSessions.facilityId, actor.facilityId), eq(drawerSessions.status, "OPEN")));
      const sum = await drawerSummary(db, drawer);
      await closeDrawer(actor, { countedCash: sum.expectedCash.toFixed(2) });
      await expect(voidSale(actor, { saleId, reason: "late" })).rejects.toThrow(/already been closed/);
      // A debit sale is refunded to the card, never in cash (APEX-41).
      await expect(returnSale(actor, { saleId, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "next day" })).rejects.toThrow(/paid by debit.*back to their card/);
      await expect(returnSale(actor, { saleId, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CARD", disposition: "RESTOCK", reason: "next day" })).resolves.toMatchObject({ number: expect.stringMatching(/^R-/) });
    });
  });

  describe("wholesale credit memos", () => {
    it("lower what's owed without money changing hands, never below zero", async () => {
      const shop = await createCustomer(actor, { name: "Credit Co", licenseNumber: `${run}-CC`, licenseType: "Retailer", licenseExpires: addDays(today, 100) });
      const order = await createOrder(actor, { customerId: shop.id });
      const [inv] = await db.insert(invoices).values({ orgId: actor.orgId, facilityId: actor.facilityId, orderId: order.id, customerId: shop.id, number: `INV-${run}`, total: "500.00", dueDate: addDays(today, 30) }).returning();
      await recordPayment(actor, { invoiceId: inv.id, amount: "300", method: "CHECK", paidOn: today });
      await expect(issueCreditMemo(actor, { invoiceId: inv.id, amount: "250", reason: "damaged" })).rejects.toThrow(/at most the \$200.00 still owed/);
      await expect(issueCreditMemo(actor, { invoiceId: inv.id, amount: "50", reason: "" })).rejects.toThrow(/Say what the credit is for/);
      expect(await issueCreditMemo(actor, { invoiceId: inv.id, amount: "50", reason: "2 cases damaged in transit" })).toEqual({ balance: "150.00" });
      const rows = await db.select().from(payments).where(eq(payments.invoiceId, inv.id));
      expect(rows.find((p) => p.method === "CREDIT_MEMO")).toMatchObject({ amount: "50.00", reference: "2 cases damaged in transit" });
      expect(await issueCreditMemo(actor, { invoiceId: inv.id, amount: "150", reason: "price correction" })).toEqual({ balance: "0.00" });
      await expect(issueCreditMemo(actor, { invoiceId: inv.id, amount: "1", reason: "more" })).rejects.toThrow(/already settled/);
    });
  });
});
