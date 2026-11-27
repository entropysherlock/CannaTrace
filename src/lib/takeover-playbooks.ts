/**
 * Take over playbooks: the fastest known routes for the big jobs, learned by running them against the real app.
 * The matching ones are handed to the agent with every step, so it goes straight to the right page and form
 * instead of exploring. Every route here was walked through in the practice store; keep them in sync with the app.
 */

export type Playbook = {
  id: string;
  title: string;
  /** Matches the person's goal (lower-cased). */
  when: RegExp;
  /** Skip this playbook when the goal also matches this (a bigger job that already covers it). */
  unless?: RegExp;
  steps: string[];
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "make-batch",
    title: "Make product from a recipe (jars, pre-rolls, edibles)",
    when: /\b(make|produce|manufactur|run|batch(es)?|recipe|jars?|pre-?rolls?|gummies|package up)\b/,
    steps: [
      "Go straight to /manufacturing/recipes (navigate). Use the \"Make a batch\" card at the top.",
      "Pick the Recipe, type the number of batches (one batch makes the recipe's yield: 500 jars from a 100-jar recipe is 5 batches), check the room (\"Finished product goes to\"), press \"Make it\".",
      "In a practice store the run finishes by itself and opens the run page: read the run name (RUN-…), output package (PKG-…) and Cost per unit there.",
      "If a red \"Not enough stock\" message appears, do not press again: report what is short. Don't use \"Plan a multi-stage run\" unless the goal needs one recipe's output inside another.",
    ],
  },
  {
    id: "plan-materials",
    title: "Plan production and work out what to buy",
    when: /\b(plan|what (do )?i need|shortfall|short|buy|materials?|enough)\b/,
    steps: [
      "Go to /manufacturing/planning. Pick the recipe, type batches, press \"Work out the plan\".",
      "Read the Materials table: needed, on hand and short for each item. Items with short \"none\" are covered.",
    ],
  },
  {
    id: "grow-batch",
    title: "Start a grow batch and tag plants",
    when: /\b(grow|plants?|clones?|seeds?|veg|flower(ing)? room|tag|cultivat)/,
    steps: [
      "Go to /cultivation (the Grow guide, step 1 Start). The batch name there is optional: leave it blank and it names itself.",
      "Strain: type the name, then click the matching option in the list. Started from: Clones or Seeds. How many. Room. Press \"Start batch\".",
      "Then use the next step's button to tag the plants (step 2 Tag) and press its apply button. The Plants page then lists the new tags.",
      "Avoid /cultivation/overview for starting: its Batch name box is required.",
    ],
  },
  {
    id: "harvest",
    title: "Harvest, dry weight and package",
    when: /\b(harvest|harvesting|wet weight|dry weight|dried|drying)/,
    steps: [
      "Harvests are recorded in the Grow guide at /cultivation, NOT from the Harvests list (that list has no start button).",
      "In the step bar click \"Harvest\" (step 4). Tick the flowering plant group(s) to cut, enter the Wet weight, pick the \"Dry in room\", then press \"Record harvest\". If it says no flowering plants, the plants must be moved to Flowering first (the Move step).",
      "To weigh after drying click \"Dry\", pick the harvest, enter the Dry weight, press \"Save dry weight\". To package click \"Package\", pick the harvest, item and weight, press its button.",
      "The Harvests list at /cultivation/harvests only shows the result, open it to confirm the new harvest appears.",
    ],
  },
  {
    id: "plants-lookup",
    title: "Count or find plants",
    when: /\b(how many plants?|plants? in|count (the )?plants?|which plants?)\b/,
    steps: [
      "Go to /cultivation/plants. Use the Any phase / Any room / Any strain filters and press Filter.",
      "The page says \"N active tagged plants shown\" and lists each tag with strain, room, phase and day.",
    ],
  },
  {
    id: "strains",
    title: "Add or look up a strain",
    when: /\bstrains?\b/,
    steps: ["Go to /cultivation/strains. The list is on the page; the add form there takes a name and a type (Indica, Sativa, Hybrid). Confirm it appears in the list."],
  },
  {
    id: "inventory-lookup",
    title: "Find a package",
    when: /\b(find|look ?up|where is|quantity|how much|pkg-\d+|package|stock|inventory)\b/,
    unless: /\b(receive|received|put away|make|produce|manufactur|batch(es)?)\b/,
    steps: [
      "Fastest: navigate straight to /inventory?q=<words from the item or tag>&status=active (like /inventory?q=Blue+Mesa+Flower&status=active). Read the rows: each shows tag, item, quantity and location. For a total, add up the rows' quantities.",
      "Don't click a row unless you need its history, and don't re-type the same search: the first result list is the answer.",
    ],
  },
  {
    id: "receive-package",
    title: "Receive a package into inventory",
    when: /\b(receive|received|put away|arrived|check in)\b/,
    steps: [
      "Go to /inventory/receive. Fields: Package tag (blank generates one), Item, Quantity, Put away to, then optional vendor, lot, cost and note. Press \"Receive\".",
      "The Item list is very long: type words from the item name to narrow it, then pick the exact match. Receiving a whole manifest is a different page (/inventory/receive/shipment); use it only when the goal says shipment.",
    ],
  },
  {
    id: "equipment",
    title: "Add or log equipment",
    when: /\b(equipment|machine|sealer|filler|maintenance)\b/,
    steps: ["Go to /manufacturing/equipment. The add form requires a Kind (like Sealer or Filler); if the goal doesn't say, use a sensible one and say which you used."],
  },
  {
    id: "wholesale-order",
    title: "Start a wholesale order",
    when: /\b(wholesale|order|ship to|deliver|invoice|customer)\b/,
    steps: [
      "Go to /distribution. \"Start an order\" needs Ship to (a vendor or destination) and optional notes; press \"Start order\", then add lines on the order page.",
      "Add a line: Item (type part of the name, then click the exact option), Quantity, and Unit price. If the page says the item isn't on the customer's price list, a Unit price is required: use the one in the goal, otherwise \"ask\" for it. A \"Line added.\" notice means it worked.",
      "Never send, deliver or cancel an order unless the goal says to; read statuses from the list instead.",
    ],
  },
  {
    id: "register",
    title: "Register / point of sale",
    when: /\b(register|pos|sell|sale|ring up|checkout|customer screen)\b/,
    steps: ["The register (/pos) needs an ID scan to start each sale. Don't try to get past that: use \"ask\" and tell the person to scan the ID, then continue."],
  },
];

/** The playbooks that apply to this goal, as text for the agent. Empty when none match. */
export function playbooksFor(goal: string, max = 3): string {
  const text = goal.toLowerCase();
  const hits = PLAYBOOKS.filter((p) => p.when.test(text) && !(p.unless && p.unless.test(text))).slice(0, max);
  if (!hits.length) return "";
  return hits.map((p) => `• ${p.title}\n${p.steps.map((s, i) => `   ${i + 1}. ${s}`).join("\n")}`).join("\n");
}

/**
 * Long dropdowns (the item list has hundreds of entries) can't all be shown. Keep the options that share a
 * word with the goal, drop repeats, and fill up with the rest so the agent still sees real choices.
 */
export function pickOptions(options: string[], goal: string, limit: number): string[] {
  const unique = Array.from(new Set(options.map((o) => o.trim()).filter(Boolean)));
  if (unique.length <= limit) return unique;
  const words = Array.from(new Set(goal.toLowerCase().match(/[a-z0-9][a-z0-9.#-]{2,}/g) ?? []));
  const score = (o: string) => words.filter((w) => o.toLowerCase().includes(w)).length;
  return unique
    .map((o, i) => ({ o, i, s: score(o) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.o);
}
