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
  /** The first link whose address starts with this, optionally only inside a card. */
  | { link: string; inCard?: string }
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
};

export type Walkthrough = {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  permission: Permission;
  steps: Step[];
};

const HARVEST = /^\/cultivation\/harvests\/[^/]+$/;
const BATCH = /^\/cultivation\/batches\/[^/]+$/;
const PACKAGE = /^\/inventory\/(?!receive$)[^/]+$/;
const RUN = /^\/manufacturing\/runs\/[^/]+$/;
const ORDER = /^\/distribution\/orders\/[^/]+$/;

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
        body: "Pick the item and how much goes in each package. Leave the tag blank and CannaTrace makes a unique ID. Strain and harvest come along automatically.",
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
        target: [{ card: "Pick a package" }],
        title: "Pick packages",
        body: "Scan the package for each line. CannaTrace checks it's the right item, has enough, and passed its lab test.",
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
