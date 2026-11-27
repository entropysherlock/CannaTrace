import Decimal from "decimal.js";
import { InventoryError } from "./inventory-math";

export const COST_KINDS = [
  { value: "LABOR", label: "Labor" },
  { value: "PACKAGING", label: "Packaging and supplies" },
  { value: "OVERHEAD", label: "Overhead (power, rent share, equipment)" },
  { value: "OTHER", label: "Other" },
] as const;
export const COST_KIND_LABEL: Record<string, string> = Object.fromEntries(COST_KINDS.map((k) => [k.value, k.label]));

export function parseCostKind(raw: unknown): string {
  const kind = String(raw ?? "").trim();
  if (!COST_KINDS.some((k) => k.value === kind)) throw new InventoryError("Pick what kind of cost this is.");
  return kind;
}

export function parseCostAmount(raw: unknown): Decimal {
  const text = String(raw ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new InventoryError("Enter the cost in dollars, like 45 or 45.50.");
  const amount = new Decimal(text);
  if (amount.lte(0)) throw new InventoryError("The cost must be more than zero.");
  if (amount.gt(1_000_000)) throw new InventoryError("That cost looks too large. Check the amount.");
  return amount;
}

export type BreakdownRow = { label: string; amount: Decimal; share: Decimal | null; group: "inputs" | "other" };

/**
 * Where a run's money went: inputs grouped by item category, then each kind of other cost.
 * Inputs with no cost on record are counted separately, because their cost is unknown, not zero.
 */
export function costBreakdown(
  inputs: { category: string; quantity: Decimal.Value; costPerUnit: Decimal.Value | null }[],
  costs: { kind: string; amount: Decimal.Value }[],
): { rows: BreakdownRow[]; total: Decimal; uncosted: number } {
  const sums = new Map<string, { group: "inputs" | "other"; amount: Decimal }>();
  let uncosted = 0;
  const add = (label: string, group: "inputs" | "other", amount: Decimal) => {
    const key = `${group}:${label}`;
    sums.set(key, { group, amount: (sums.get(key)?.amount ?? new Decimal(0)).add(amount) });
  };
  for (const i of inputs) {
    if (i.costPerUnit === null) uncosted++;
    else add(i.category, "inputs", new Decimal(i.quantity).mul(i.costPerUnit));
  }
  for (const c of costs) add(COST_KIND_LABEL[c.kind] ?? "Other", "other", new Decimal(c.amount));
  const total = [...sums.values()].reduce((t, v) => t.add(v.amount), new Decimal(0));
  const rows = [...sums].map(([key, v]) => ({
    label: key.slice(key.indexOf(":") + 1),
    group: v.group,
    amount: v.amount.toDecimalPlaces(2),
    share: total.gt(0) ? v.amount.div(total).mul(100).toDecimalPlaces(1) : null,
  }));
  rows.sort((a, b) => (a.group === b.group ? b.amount.cmp(a.amount) : a.group === "inputs" ? -1 : 1));
  return { rows, total: total.toDecimalPlaces(2), uncosted };
}
