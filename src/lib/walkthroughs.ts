import type { Permission } from "@/lib/rbac";

/**
 * SmartWorkflows guided walkthroughs: "Show me how" for a whole job that crosses modules.
 * Each step names the page it happens on and the thing to highlight there, found by what the
 * employee sees (a card's title, a button's words, a field's name), so pages need no extra markup.
 * Pure data: the overlay in components/walkthrough.tsx reads it.
 */

export type Target =
  /** A card, by its heading. */
  | { card: string }
  /** A fold-out section (details/summary), by its summary text. It's opened when highlighted. */
  | { fold: string }
  /** A button or link, by the words on it (the start of them is enough). */
  | { text: string }
  /** The first link whose address starts with this, optionally only inside a card, skipping addresses that start with `except`. */
  | { link: string; inCard?: string; except?: string[] }
  /** A form field, by its name. */
  | { field: string };

export type Step = {
  /** The page this step happens on. */
  path: RegExp;
  /** Where "Take me there" goes when the step's page is a fixed address. */
  go?: string;
  /** What to highlight: the first of these found on the page. None means a message in the middle. */
  target?: Target[];
  title: string;
  body: string;
  /**
   * How the step moves on, besides pressing Next:
   * "save" (default): when a form in the highlighted area saves.
   * "click": when the highlighted thing is clicked.
   * "next": only Next, for steps done several times over (adding inputs, order lines).
   */
  advance?: "save" | "click" | "next";
  /** Already done when its target isn't on the page (a drawer that's already open): the step skips itself. */
  optional?: boolean;
};

export type Walkthrough = {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  permission: Permission;
  /** Only offered at facilities with a register (retail stores and microbusinesses). */
  retailOnly?: boolean;
  steps: Step[];
};

/** Facilities that sell to customers, and so have a register. */
export const sellsRetail = (licenseType: string | null | undefined) => licenseType === "RETAIL" || licenseType === "MICROBUSINESS";

/** The walkthroughs someone may run here: their role allows it, and the facility has what it needs. */
export function walkthroughsFor(can: (p: Permission) => boolean, licenseType: string | null | undefined): string[] {
  return WALKTHROUGHS.filter((w) => can(w.permission) && (!w.retailOnly || sellsRetail(licenseType))).map((w) => w.id);
}

const HARVEST = /^\/cultivation\/harvests\/[^/]+$/;
const BATCH = /^\/cultivation\/batches\/[^/]+$/;
const PACKAGE = /^\/inventory\/(?!receive$)[^/]+$/;
const RUN = /^\/manufacturing\/runs\/[^/]+$/;
const ORDER = /^\/distribution\/orders\/[^/]+$/;
const SALE = /^\/pos\/sales\/[^/]+$/;
const RECEIPT = /^\/pos\/sales\/[^/]+\/receipt$/;
const COUNT = /^\/counts\/[^/]+$/;
/** A package in the inventory list, not the Receive tab. */
const PACKAGE_LINK = { link: "/inventory/", except: ["/inventory/receive"] };

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: "harvest-to-shelf",
    title: "Harvest to shelf",
    summary: "Dry weight, packages, lab test, and labels for one harvest.",
    minutes: 4,
    permission: "cultivation.write",
    steps: [
      {
        path: /^\/cultivation\/harvests$/,
        go: "/cultivation/harvests",
        target: [{ link: "/cultivation/harvests/" }],
        title: "Open a harvest",
        body: "These are your harvests. Open one that's drying.",
        advance: "click",
      },
      {
        path: HARVEST,
        target: [{ card: "Record dry weight" }, { card: "Weights" }],
        title: "Record the dry weight",
        body: "When it's done drying, weigh the whole harvest and save the dry weight here. Already done? Press Next.",
      },
      {
        path: HARVEST,
        target: [{ card: "Package from this harvest" }],
        title: "Make packages",
        body: "Pick the item, how much goes in each package, and how many packages to make: ten jars of the same size is one save. Leave the tag blank and CannaTrace makes a unique ID for each. Strain and harvest come along automatically.",
      },
      {
        path: HARVEST,
        target: [{ link: "/inventory/", inCard: "Packages made" }],
        title: "Open a new package",
        body: "Here's what you made. Open a package to test and label it.",
        advance: "click",
      },
      {
        path: PACKAGE,
        target: [{ fold: "Add lab result" }, { card: "Lab results" }],
        title: "Record the lab test",
        body: "When the certificate comes back, enter the THC, CBD, and pass or fail here. A package can't be sold until it passes.",
      },
      {
        path: PACKAGE,
        target: [
          { text: "Print product label" },
          { text: "Print package label" },
        ],
        title: "Print the label",
        body: "SmartLabel fills in the strain, batch, potency, and New Mexico warnings from this package. Nothing to retype.",
        advance: "click",
      },
      {
        path: /^\/labels/,
        title: "That's the whole job",
        body: "Check the preview and print. From harvest to a labelled package on the shelf, every step is in the audit trail.",
      },
    ],
  },
  {
    id: "start-a-grow",
    title: "Start a grow",
    summary:
      "Add a strain, start a batch, tag plants, and move them to flower.",
    minutes: 3,
    permission: "cultivation.write",
    steps: [
      {
        path: /^\/cultivation\/strains$/,
        go: "/cultivation/strains",
        target: [{ card: "Add a strain" }],
        title: "Add the strain",
        body: "Is it new? Add the strain once with its type. Already listed? Press Next.",
      },
      {
        path: /^\/cultivation$/,
        go: "/cultivation",
        target: [{ card: "Start a batch" }],
        title: "Start a batch",
        body: "A batch is a group of clones or seeds planted together. Choose the strain, how many, and the room, then press Start batch.",
      },
      {
        path: BATCH,
        target: [{ card: "Tag plants" }],
        title: "Tag the plants",
        body: "Give each plant its own ID. Leave tags blank and CannaTrace numbers them for you (PLT-000123).",
      },
      {
        path: /^\/cultivation\/plants$/,
        go: "/cultivation/plants",
        target: [{ text: "Apply to ticked plants" }],
        title: "Move them to flowering",
        body: "When they flip, tick the plants, choose Flowering and the new room, and apply. Every plant moves in one step.",
      },
    ],
  },
  {
    id: "make-a-product",
    title: "Make a product",
    summary: "A recipe, a production run, inputs, yield, and the label.",
    minutes: 4,
    permission: "manufacturing.write",
    steps: [
      {
        path: /^\/manufacturing\/recipes$/,
        go: "/manufacturing/recipes",
        target: [{ text: "New recipe" }, { card: "New recipe" }],
        title: "Write the recipe once",
        body: "A recipe says what one batch uses and how much it makes, like 350 g of flower and 100 jars for 100 jars. Already have it? Press Next.",
      },
      {
        path: /^\/manufacturing$/,
        go: "/manufacturing",
        target: [{ text: "New run" }, { card: "Start a new run" }],
        title: "Start a run",
        body: "Open a new run, choose the recipe and how many batches, and start it.",
        advance: "click",
      },
      {
        path: /^\/manufacturing$/,
        target: [{ card: "Start a new run" }],
        title: "Name it and start",
        body: "The run name is filled in for today. Choose the recipe and batches, then press Start run.",
      },
      {
        path: RUN,
        target: [{ card: "Add an input" }],
        title: "Add what you use",
        body: "Scan or type each input package's tag and how much you took. The list above shows what's still to go.",
        advance: "next",
      },
      {
        path: RUN,
        target: [{ card: "Complete the run" }],
        title: "Complete the run",
        body: "Enter how much you actually made and where it goes. CannaTrace works out yield and cost per unit and makes the output package.",
      },
      {
        path: RUN,
        target: [
          { text: "Print product label" },
          { text: "Print package label" },
        ],
        title: "Label the product",
        body: "Print labels straight from the run. The output package carries the lot and everything it was made from.",
      },
    ],
  },
  {
    id: "fill-an-order",
    title: "Fill a wholesale order",
    summary:
      "Order lines, picking packages, packing, the manifest, and the invoice.",
    minutes: 4,
    permission: "sales.write",
    steps: [
      {
        path: /^\/distribution$/,
        go: "/distribution",
        target: [{ card: "Start an order" }],
        title: "Start the order",
        body: "Choose the customer and where it's going, then press Start order.",
      },
      {
        path: ORDER,
        target: [{ card: "Add a line" }],
        title: "Add what they ordered",
        body: "One line per product: the item, how many, and the price. Their price list fills the price in.",
        advance: "next",
      },
      {
        path: ORDER,
        target: [{ card: "Confirm the order" }],
        title: "Confirm it",
        body: "Confirming locks the lines so the warehouse can pick.",
      },
      {
        path: ORDER,
        target: [{ card: "Pick packages" }],
        title: "Pick packages",
        body: "Press \"Pick everything, oldest first\" to fill every line at once, or open \"Or scan one package\" to scan them yourself. CannaTrace checks each is the right item, has enough, and passed its lab test.",
        advance: "next",
      },
      {
        path: ORDER,
        target: [{ card: "Mark packed" }],
        title: "Pack it",
        body: "When everything's picked and boxed, mark it packed.",
      },
      {
        path: ORDER,
        target: [{ card: "Ship" }],
        title: "Ship it",
        body: "Choose the driver and vehicle. Shipping creates the manifest and the invoice together.",
      },
      {
        path: ORDER,
        target: [{ card: "Shipment" }],
        title: "Print and get paid",
        body: "Print the manifest for the driver, and open the invoice to record payment when it comes in.",
      },
    ],
  },
  {
    id: "receive-delivery",
    title: "Receive a delivery",
    summary: "Check in a package that arrived and put it away.",
    minutes: 1,
    permission: "inventory.write",
    steps: [
      {
        path: /^\/inventory\/receive$/,
        go: "/inventory/receive",
        target: [{ field: "tag" }],
        title: "Scan the tag",
        body: "Scan the package's tag with a barcode scanner or the camera. No tag? Leave it blank and CannaTrace makes one.",
      },
      {
        path: /^\/inventory\/receive$/,
        target: [{ field: "itemId" }],
        title: "What is it?",
        body: "Choose the product. Not listed? Add it under Catalog first.",
      },
      {
        path: /^\/inventory\/receive$/,
        target: [{ field: "quantity" }],
        title: "How much arrived",
        body: "Enter the amount in the product's unit, then where you're putting it away.",
      },
      {
        path: /^\/inventory\/receive$/,
        target: [{ text: "Receive" }],
        title: "Receive it",
        body: "Press Receive. The package is in inventory and on the audit trail right away.",
        advance: "click",
      },
      {
        path: PACKAGE,
        title: "Done",
        body: "This is the package's page: move it, test it, label it, or split it from here.",
      },
    ],
  },
  {
    id: "register-shift",
    retailOnly: true,
    title: "Run a register shift",
    summary: "Open your drawer, check ID, ring up a sale, take payment, and count out.",
    minutes: 5,
    permission: "pos.use",
    steps: [
      {
        path: /^\/pos$/,
        go: "/pos",
        target: [{ text: "Open drawer" }],
        title: "Open your drawer",
        body: "Count the cash you're starting with, type it in, and press Open drawer. This drawer is yours: only your sales go into it.",
        advance: "click",
        optional: true,
      },
      {
        path: /^\/pos$/,
        target: [{ text: "Start sale" }, { text: "No scanner?" }],
        title: "Check their ID",
        body: "Scan the barcode on the back of the customer's ID. CannaTrace checks their age and that the ID hasn't expired. No scanner? Type the dates from the ID. When it says OK to serve, press Start sale.",
        // Starting the sale opens the cart, which moves this on; tapping "No scanner?" must not.
        advance: "next",
      },
      {
        path: SALE,
        target: [{ text: "Pay" }],
        title: "Ring up and take payment",
        body: "Scan each product's barcode, or tap it on the menu. The bars under the cart show how close they are to today's limits, and CannaTrace stops you before they go over. Then press Pay (or F2), choose cash, debit, or split, and press Complete sale. For cash, type what they handed you and CannaTrace shows the change. For debit, run it on the card terminal first.",
        advance: "click",
      },
      {
        path: RECEIPT,
        target: [{ text: "Print receipt" }, { text: "Next customer" }],
        title: "Hand over the receipt",
        body: "The receipt lists every package tag the product came from. Print it if they want it, then press Next customer for the next person in line.",
        advance: "next",
      },
      {
        path: /^\/pos\/drawer$/,
        go: "/pos/drawer",
        target: [{ card: "Close your drawer" }],
        title: "Count out at the end of your shift",
        body: "Count everything in your drawer, including the starting cash, and enter it. You won't see what it should hold until you've counted. That keeps every count honest.",
      },
      {
        path: /^\/pos\/drawer\/[^/]+$/,
        title: "Your end-of-shift report",
        body: "This is your shift: sales, cash, card, and whether the drawer was over or short. Tell your manager about any difference before you leave.",
      },
    ],
  },
  {
    id: "find-and-move",
    title: "Find and move a package",
    summary: "Scan or search for a package, check it, and move it to another room.",
    minutes: 2,
    permission: "inventory.write",
    steps: [
      {
        path: /^\/inventory$/,
        go: "/inventory",
        target: [{ field: "q" }],
        title: "Scan or search",
        body: "Scan the package's barcode, or type part of its tag, the product name, SKU, or lot, and press Search. A barcode scanner works right in this box.",
        advance: "next",
      },
      {
        path: /^\/inventory$/,
        target: [PACKAGE_LINK],
        title: "Open the package",
        body: "Check the tag matches the one in your hand, then open it.",
        advance: "click",
      },
      {
        path: PACKAGE,
        target: [{ card: "Details" }],
        title: "Check what you have",
        body: "The quantity, where it's stored, its lot, and its status. Only Active packages can be sold or shipped. Anything on hold or in quarantine stays where it is.",
        advance: "next",
      },
      {
        path: PACKAGE,
        target: [{ fold: "Move" }],
        title: "Move it",
        body: "Choose the new room or shelf and press Move package.",
      },
      {
        path: PACKAGE,
        target: [{ card: "Inventory history" }],
        title: "There's the record",
        body: "Every move, count, and adjustment shows here with who did it and when. Nobody edits a quantity directly, so every change leaves a trail.",
      },
    ],
  },
  {
    id: "count-a-room",
    title: "Count a room",
    summary: "Count every package in one location, and CannaTrace corrects the differences.",
    minutes: 3,
    permission: "inventory.adjust",
    steps: [
      {
        path: /^\/counts$/,
        go: "/counts",
        target: [{ link: "/counts/", inCard: "Count a location" }],
        title: "Pick the room",
        body: "Choose the room or shelf you're counting. Count one location at a time, and don't move product in or out while you count.",
        advance: "click",
      },
      {
        path: COUNT,
        title: "Count what's really there",
        body: "For each package, enter what you actually find, in the unit shown. Don't copy the system's number. Enter 0 for a package that's missing.",
        advance: "next",
      },
      {
        path: COUNT,
        target: [{ text: "Save count" }],
        title: "Save the count",
        body: "Press Save count. Any difference becomes a logged correction with your name on it, and it's reported to the state like any other adjustment.",
      },
      {
        path: COUNT,
        title: "Big difference?",
        body: "A big miss usually means a missed shelf or a move nobody recorded. Look again before anyone recounts, and tell your manager about anything you can't explain.",
      },
    ],
  },
  {
    id: "hold-and-destroy",
    title: "Hold and destroy waste",
    summary: "Put product on hold, wait out the state's hold period, then record its destruction.",
    minutes: 3,
    permission: "inventory.adjust",
    steps: [
      {
        path: /^\/inventory$/,
        go: "/inventory",
        target: [{ field: "q" }],
        title: "Find the product",
        body: "Scan or search for the package that's damaged, expired, failed testing, or otherwise has to go.",
        advance: "next",
      },
      {
        path: /^\/inventory$/,
        target: [PACKAGE_LINK],
        title: "Open it",
        body: "Make sure the tag matches the product in front of you, then open it.",
        advance: "click",
      },
      {
        path: PACKAGE,
        target: [{ fold: "Hold, quarantine, or destroy" }],
        title: "Put it on hold",
        body: "Choose On hold (or Quarantine for a failed test) and say why, for example \"Broken seal, 3 jars\". Held product can't be sold, shipped, or used, and the state's hold clock starts now.",
      },
      {
        path: PACKAGE,
        title: "Wait out the hold period",
        body: "New Mexico requires waste to sit on hold for 72 hours before it's destroyed, and other states have their own rule. CannaTrace won't let you destroy it early and tells you the exact time it's allowed. Keep it in the quarantine area until then.",
        advance: "next",
      },
      {
        path: PACKAGE,
        target: [{ fold: "Hold, quarantine, or destroy" }],
        title: "Destroy it when the time comes",
        body: "Mix it with at least as much non-cannabis waste (soil, cat litter, food waste) so it's unusable. Then come back here, choose Destroyed, say how, and tick the mixing box. That's your destruction record for the state.",
        advance: "next",
      },
    ],
  },
  {
    id: "morning-check",
    title: "Your morning check with Tally",
    summary: "See what needs attention today, fix it with one approval, and ask Tally anything.",
    minutes: 2,
    permission: "inventory.view",
    steps: [
      {
        path: /^\/dashboard$/,
        go: "/dashboard",
        title: "Start at the Dashboard",
        body: "The numbers at the top are today at this facility: stock, plants, orders, sales, and alerts. Check the facility menu at the top shows where you're working.",
        advance: "next",
      },
      {
        path: /^\/watch$/,
        go: "/watch",
        target: [{ text: "Check now" }],
        title: "What Tally Watch found",
        body: "Every morning Tally Watch checks for problems: failed lab tests, labels not printed, licenses about to expire, harvests left open. The most urgent come first. Press Check now to look again any time.",
        advance: "next",
      },
      {
        path: /^\/watch$/,
        title: "Fix it, or ask",
        body: "Where a fix is safe, the finding has a button such as Hold it or Prepare the labels. It shows exactly what will change before you approve, and every fix can be undone. Otherwise, Open takes you to the record and Ask Tally explains it.",
        advance: "next",
      },
      {
        path: /^\/watch$/,
        title: "Ask Tally anything",
        body: "Press the Tally button at the bottom right (or Ctrl+J) and ask in plain English: \"What's on hold?\", \"Where is package CT-000101?\", \"What sold yesterday?\" Tally only sees what your role can see, and never changes anything until you press Confirm.",
      },
    ],
  },
];

export const walkthroughById = (id: string) =>
  WALKTHROUGHS.find((w) => w.id === id);

/**
 * Where the walkthrough stands after the employee lands on a page. If the current step isn't
 * for this page but the next one is (a form saved and moved them on), it moves forward.
 */
export function stepAfterArriving(
  w: Walkthrough,
  index: number,
  pathname: string,
): number {
  const here = w.steps[index];
  if (!here || here.path.test(pathname)) return index;
  const next = w.steps[index + 1];
  return next && next.path.test(pathname) ? index + 1 : index;
}
