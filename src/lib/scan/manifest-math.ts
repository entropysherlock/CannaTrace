/** Matching what a manifest says to what the business already has. Pure, so it is tested alone. */

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1));

/** The item a manifest line is most likely about: its SKU appears in the text, or most of its words match one item. */
export function matchItem<T extends { id: string; name: string; sku: string }>(product: string, items: T[]): T | null {
  const text = product.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const bySku = items.filter((i) => i.sku && lower.includes(i.sku.toLowerCase()));
  if (bySku.length === 1) return bySku[0];
  const want = words(text);
  if (!want.size) return null;
  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  for (const item of items) {
    const have = words(item.name);
    if (!have.size) continue;
    const shared = [...want].filter((w) => have.has(w)).length;
    // Most of what the manifest says must be in the item's name, and most of the name in what the manifest says.
    const score = Math.min(shared / want.size, shared / have.size);
    if (score > bestScore + 1e-9) {
      best = item;
      bestScore = score;
      tie = false;
    } else if (Math.abs(score - bestScore) < 1e-9 && score > 0) tie = true;
  }
  return best && bestScore >= 0.6 && !tie ? best : null;
}

/** The vendor a sender name most likely is. Only a clear match counts. */
export function matchVendor<T extends { id: string; name: string }>(sender: string, vendors: T[]): T | null {
  const want = words(sender);
  if (!want.size) return null;
  let found: T | null = null;
  for (const v of vendors) {
    const have = words(v.name);
    const shared = [...want].filter((w) => have.has(w)).length;
    if (shared && shared / Math.max(want.size, have.size) >= 0.6) {
      if (found) return null;
      found = v;
    }
  }
  return found;
}
