import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { CartScreen, type CartView } from "@/components/register/cart-screen";
import { RegisterShell } from "@/components/register/shell";
import { discountPresets, itemCategories, items, retailPrices, rewardMembers, sales } from "@/db/schema";
import { db } from "@/lib/db";
import { cartPromos } from "@/lib/promotions";
import { cartLines, getRetailSettings, saleTotals, sellableByItem, storePack, waitingOnLabByItem } from "@/lib/pos";
import { LIMIT_LABELS, limitUsage, quickCashAmounts } from "@/lib/pos-math";
import { getProgram } from "@/lib/rewards";
import { earnSpeedFor, getExclusions } from "@/lib/loyalty-earn";
import { eligibleShare } from "@/lib/loyalty-math";
import { pointsAtSpeed } from "@/lib/loyalty-math";
import { maskPhone, rewardsAvailable } from "@/lib/rewards-math";
import { effectiveLimits } from "@/lib/rules";
import { requirePagePermission } from "@/lib/session";
import { facilityToday } from "@/lib/time";
import { unitLabel } from "@/lib/units";
import { shellInfo } from "../../shell-info";

const num = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(3).toString();

export default async function CartPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notAdded?: string }> }) {
  const session = await requirePagePermission("pos.use");
  const { id } = await params;
  const { notAdded } = await searchParams;
  const [sale] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, id), eq(sales.orgId, session.orgId), eq(sales.facilityId, session.facilityId)));
  if (!sale) notFound();
  if (sale.status !== "OPEN") redirect(`/pos/sales/${sale.id}/receipt`);

  const [info, lines, settings, pack, menu, discounts] = await Promise.all([
    shellInfo(session),
    cartLines(db, sale.id),
    getRetailSettings(db, session.facilityId),
    storePack(db, session.facilityId),
    db
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        barcode: items.barcode,
        unit: items.unit,
        category: itemCategories.name,
        price: retailPrices.price,
        limitCategory: items.limitCategory,
        limitPerUnit: items.limitPerUnit,
      })
      .from(retailPrices)
      .innerJoin(items, eq(items.id, retailPrices.itemId))
      .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
      .where(and(eq(retailPrices.facilityId, session.facilityId), eq(items.active, true)))
      .orderBy(asc(itemCategories.name), asc(items.name)),
    db
      .select()
      .from(discountPresets)
      .where(and(eq(discountPresets.orgId, session.orgId), eq(discountPresets.active, true)))
      .orderBy(asc(discountPresets.name)),
  ]);

  const sellable = await sellableByItem(db, session, pack);
  const waitingOnLab = await waitingOnLabByItem(db, session, pack);
  const program = await getProgram(db, session.orgId);
  const promos = await cartPromos(db, session, lines);
  const exclusions = await getExclusions(db, session.orgId);
  const share = eligibleShare(lines, exclusions);
  const totals = saleTotals(lines, sale, settings, program, promos.total, share);
  const [member] =
    program.enabled && sale.rewardMemberId ? await db.select().from(rewardMembers).where(and(eq(rewardMembers.id, sale.rewardMemberId), eq(rewardMembers.orgId, session.orgId))) : [];
  const speed = member ? await earnSpeedFor(db, session.orgId, member.id, await facilityToday(session.facilityId)) : null;
  const afterDiscount = totals.subtotal.sub(totals.promo).sub(totals.discount).mul(share);
  const usage = limitUsage(lines);
  const { limits } = effectiveLimits(
    { FLOWER: new Decimal(settings.flowerLimitGrams), CONCENTRATE: new Decimal(settings.concentrateLimitGrams), EDIBLE: new Decimal(settings.edibleLimitMg) },
    pack,
    sale.customerType,
  );
  const taxExempt = sale.customerType === "MEDICAL" && settings.medicalTaxExempt;
  const categories = [...new Set(menu.map((m) => m.category ?? "Other"))];

  const view: CartView = {
    saleId: sale.id,
    number: sale.number,
    customerLabel: sale.customerType === "MEDICAL" ? "Medical patient" : "Adult use",
    checkedBy: sale.userName.split(" ")[0],
    lines: lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      name: l.itemName,
      quantity: num(l.quantity),
      unitPrice: new Decimal(l.unitPrice).toFixed(2),
      lineTotal: new Decimal(l.quantity).mul(l.unitPrice).toDecimalPlaces(2).toFixed(2),
      unitLabel: unitLabel(l.unit),
    })),
    menu: menu.map((m) => {
      const stock = sellable.get(m.id) ?? new Decimal(0);
      const limit = m.limitCategory !== "NONE" && m.limitPerUnit ? `Counts ${num(m.limitPerUnit)} ${LIMIT_LABELS[m.limitCategory].unit} ${m.limitCategory === "EDIBLE" ? "edible THC" : LIMIT_LABELS[m.limitCategory].name.toLowerCase()}` : null;
      return {
        id: m.id,
        name: m.name,
        sku: m.sku,
        barcode: m.barcode,
        category: m.category ?? "Other",
        price: new Decimal(m.price).toFixed(2),
        unitLabel: unitLabel(m.unit),
        stock: num(stock),
        outOfStock: stock.lte(0),
        waitingOnLab: stock.lte(0) && waitingOnLab.has(m.id),
        limitNote: limit,
      };
    }),
    categories,
    discounts: discounts.map((d) => ({ id: d.id, name: d.name, label: `${d.name} ${num(d.percent)}%` })),
    promoNames: promos.names.join(", "),
    discountName: sale.discountName,
    totals: {
      subtotal: totals.subtotal.toFixed(2),
      promo: totals.promo.toFixed(2),
      discount: totals.discount.toFixed(2),
      reward: totals.reward.toFixed(2),
      exciseTax: totals.exciseTax.toFixed(2),
      salesTax: totals.salesTax.toFixed(2),
      total: totals.total.toFixed(2),
    },
    taxLabels: {
      excise: `Cannabis excise tax${taxExempt ? " (exempt)" : ` (${num(settings.exciseTaxPercent)}%)`}`,
      sales: `Sales tax${taxExempt ? " (exempt)" : ` (${num(settings.salesTaxPercent)}%)`}`,
    },
    limits: (["FLOWER", "CONCENTRATE", "EDIBLE"] as const).map((k) => {
      const used = usage[k];
      const limit = limits[k];
      return {
        label: LIMIT_LABELS[k].name,
        unit: LIMIT_LABELS[k].unit,
        used: num(used),
        limit: num(limit),
        share: limit.gt(0) ? Decimal.min(100, used.div(limit).mul(100)).toNumber() : 0,
      };
    }),
    rewards: program.enabled
      ? {
          member: member ? { firstName: member.firstName, phone: maskPhone(member.phone), points: member.points } : null,
          redeemPoints: program.redeemPoints,
          redeemDollars: program.redeemDollars,
          maxSharePercent: program.maxSharePercent,
          used: member ? sale.rewardsUsed : 0,
          applied: member ? totals.rewardsApplied : 0,
          available: member ? rewardsAvailable(member.points, afterDiscount, program) : 0,
          earnPreview: member ? pointsAtSpeed(totals.taxable.mul(share), program.pointsPerDollar, speed?.percent ?? 100) : 0,
          tierName: speed?.tier?.name ?? null,
          boostActive: (speed?.boost ?? 100) > 100,
          idLookup: program.idLookup && Boolean(sale.customerKey),
          idLinked: Boolean(member?.idKey),
        }
      : null,
    quickCash: quickCashAmounts(totals.total),
    notAdded: notAdded ? notAdded.split(" | ").slice(0, 10) : undefined,
  };

  return (
    <RegisterShell info={info}>
      <CartScreen view={view} />
    </RegisterShell>
  );
}
