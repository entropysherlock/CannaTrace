/**
 * What the Grow guide's Package form fills in for a harvest: its one bulk item (counted in grams) and everything that's
 * left as the weight. Only for a harvest that has been weighed dry: before that, "what's left" is the wet weight, and
 * one tap must not package water.
 */
export function packageDraft(
  harvest: { strain: string; leftG: string; weighed: boolean },
  items: { id: string; strain: string | null; unit: string }[],
): { itemId: string; quantity: string } | null {
  if (!harvest.weighed) return null;
  const mine = items.filter((i) => i.unit === "G" && i.strain && i.strain.trim().toLowerCase() === harvest.strain.trim().toLowerCase());
  return mine.length === 1 ? { itemId: mine[0].id, quantity: harvest.leftG } : null;
}
