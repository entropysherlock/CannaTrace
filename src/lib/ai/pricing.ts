/**
 * Anthropic's list prices in US dollars per million tokens, from
 * https://platform.claude.com/docs/en/about-claude/pricing (checked November 2026).
 * Used to estimate what Tally costs a business; their exact charges are in the Claude Console.
 */
export const PRICES_CHECKED = "November 2026";

const PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-fable-5-2": { input: 8, output: 40 },
  "claude-mythos-5-2": { input: 8, output: 40 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-mythos-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4": { input: 15, output: 75 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4": { input: 3, output: 15 },
  // Haiku 5.5 costs more ($0.50 / $2.50) for a single request over 100,000 prompt tokens. Tally's requests are
  // far smaller than that, so the lower price is used.
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * The price for a model id, including dated or aliased ids such as "claude-sonnet-4-5-20250929". The longest
 * matching name wins, so "claude-opus-4-5-…" isn't priced as "claude-opus-4". Unknown models give null.
 */
export function priceFor(model: string): { input: number; output: number } | null {
  let best: string | null = null;
  for (const key of Object.keys(PER_MTOK)) {
    if ((model === key || model.startsWith(`${key}-`)) && (!best || key.length > best.length)) best = key;
  }
  return best ? PER_MTOK[best] : null;
}

/** Estimated dollars for some tokens on one model, or null when the model's price isn't known. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = priceFor(model);
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** "$12.34", "$0.42", or "less than $0.01" for tiny amounts that aren't zero. */
export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.005) return "less than $0.01";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
