import { fill, sampleValues } from "./fields";
import { NM_LABEL_PACK } from "./jurisdictions";
import { layoutText, lineHeightMm } from "./text";
import type { LabelDesign, LabelElement, LabelKind } from "./types";

let seq = 0;
const el = (e: Omit<LabelElement, "id">): LabelElement => ({ id: `e${++seq}`, ...e });

/** Common label stock sizes, in millimetres. */
export const STOCK_SIZES: { label: string; widthMm: number; heightMm: number }[] = [
  { label: '2" × 1"', widthMm: 50.8, heightMm: 25.4 },
  { label: '2.25" × 1.25"', widthMm: 57.15, heightMm: 31.75 },
  { label: '3" × 2"', widthMm: 76.2, heightMm: 50.8 },
  { label: '4" × 2"', widthMm: 101.6, heightMm: 50.8 },
  { label: '4" × 3"', widthMm: 101.6, heightMm: 76.2 },
  { label: '4" × 6"', widthMm: 101.6, heightMm: 152.4 },
];

export type StarterTemplate = { name: string; kind: LabelKind; jurisdiction: string | null; design: LabelDesign };

function plantTag(): LabelDesign {
  seq = 0;
  return {
    widthMm: 50.8,
    heightMm: 25.4,
    elements: [
      el({ type: "text", x: 2, y: 1.5, w: 46.8, h: 4, text: "{{plant.tag}}", fontSize: 9, bold: true }),
      el({ type: "barcode", x: 0, y: 6, w: 50.8, h: 8, value: "{{plant.tag}}", format: "code128" }),
      el({ type: "text", x: 2, y: 15, w: 46.8, h: 3.2, text: "{{plant.strain}} · {{plant.phase}}", fontSize: 7 }),
      el({ type: "text", x: 2, y: 18.6, w: 46.8, h: 3, text: "Batch {{plant.batch}} · planted {{plant.planted}}", fontSize: 6 }),
      el({ type: "text", x: 2, y: 21.8, w: 46.8, h: 3, text: "{{facility.license}}", fontSize: 6 }),
    ],
  };
}

function batchLabel(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 50.8,
    elements: [
      el({ type: "text", x: 4, y: 3, w: 93.6, h: 6, text: "{{batch.name}}", fontSize: 14, bold: true }),
      el({ type: "text", x: 4, y: 10, w: 93.6, h: 4, text: "{{batch.strain}} · {{batch.count}} plants · from {{batch.source}}", fontSize: 9 }),
      el({ type: "text", x: 4, y: 15, w: 93.6, h: 4, text: "Room {{batch.location}} · started {{batch.started}}", fontSize: 9 }),
      el({ type: "barcode", x: 2, y: 21, w: 97.6, h: 14, value: "{{batch.name}}", format: "code128" }),
      el({ type: "text", x: 4, y: 40, w: 93.6, h: 4, text: "{{facility.name}} · {{facility.license}}", fontSize: 8 }),
    ],
  };
}

function packageLabel(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 50.8,
    elements: [
      el({ type: "text", x: 4, y: 3, w: 93.6, h: 6, text: "{{item.name}}", fontSize: 13, bold: true }),
      el({ type: "text", x: 4, y: 10, w: 60, h: 4, text: "{{package.quantity}} {{package.unit}} · SKU {{item.sku}}", fontSize: 9 }),
      el({ type: "text", x: 64, y: 10, w: 33.6, h: 4, text: "Lab: {{lab.status}}", fontSize: 9, align: "right" }),
      el({ type: "barcode", x: 2, y: 16, w: 97.6, h: 14, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 4, y: 31, w: 93.6, h: 5, text: "{{package.tag}}", fontSize: 11, bold: true, align: "center" }),
      el({ type: "text", x: 4, y: 38, w: 60, h: 4, text: "Packaged {{package.created}}", fontSize: 8 }),
      el({ type: "text", x: 64, y: 38, w: 33.6, h: 4, text: "{{facility.license}}", fontSize: 8, align: "right" }),
    ],
  };
}

const NM_WARNING = (NM_LABEL_PACK.rules.find((r) => r.id === "nm-warning")!.check as { text: string }).text;

const NM_FDA =
  "This product is not approved by the FDA to treat, cure, or prevent any disease. The FDA has not evaluated it for safety, effectiveness, or quality. Long-term use may have adverse health effects, including added risks for women who are or may become pregnant or are breastfeeding.";

/** The parts every New Mexico product label shares. `potency` sits under the product name; `details` above the barcode. */
function nmLabel(potency: Omit<LabelElement, "id">[], details: Omit<LabelElement, "id">[]): LabelDesign {
  seq = 0;
  const W = 101.6;
  const top = [
    el({ type: "text", x: 4, y: 3, w: 78, h: 6, text: "{{item.name}}", fontSize: 13, bold: true }),
    el({ type: "image", x: 84.6, y: 3, w: 13, h: 13, role: "STATE_LOGO" }),
    el({ type: "text", x: 4, y: 10, w: 78, h: 4.5, text: "Total THC {{lab.thc}} · {{lab.thcMg}} per package", fontSize: 10, bold: true }),
  ];
  let y = 15;
  const stack = (items: Omit<LabelElement, "id">[]) =>
    items.map((e) => {
      const placed = el({ ...e, y });
      y += e.h + 0.6;
      return placed;
    });
  const mid = stack([
    ...potency,
    { type: "text", x: 4, y: 0, w: 78, h: 3, text: "{{item.strain}} {{item.strainType}} · Lot {{package.lot}} · Harvest {{package.harvest}}", fontSize: 6 },
    { type: "text", x: 4, y: 0, w: W - 8, h: 3, text: "Directions: {{item.directions}}", fontSize: 6 },
    { type: "text", x: 4, y: 0, w: W - 8, h: 10.5, text: NM_WARNING, fontSize: 6.5, bold: true },
    { type: "text", x: 4, y: 0, w: W - 8, h: 8, text: NM_FDA, fontSize: 5.5 },
    ...details,
    {
      type: "text",
      x: 4,
      y: 0,
      w: W - 8,
      h: 3,
      text: "Made by {{facility.name}} · License {{facility.license}} · Pesticides: {{item.pesticides}}",
      fontSize: 6,
    },
    {
      type: "text",
      x: 4,
      y: 0,
      w: W - 8,
      h: 3,
      text: "Manufactured {{package.created}} · Expires {{package.expires}} · Tested by {{lab.name}} {{lab.date}}",
      fontSize: 6,
    },
    { type: "text", x: 4, y: 0, w: W - 8, h: 3, text: "{{state.poisonCenter}}", fontSize: 6 },
  ]);
  return {
    widthMm: W,
    heightMm: 101.6,
    elements: [
      ...top,
      ...mid,
      el({ type: "barcode", x: 2, y: 77, w: W - 4, h: 8.5, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 4, y: 86, w: W - 8, h: 3.5, text: "{{package.tag}}", fontSize: 7, align: "center" }),
      el({ type: "text", x: 4, y: 91, w: W - 8, h: 6, text: "Net wt. {{package.netQuantity}}", fontSize: 12, bold: true }),
    ],
  };
}

/** Flower, pre-rolls, and concentrates: potency as lab percentages. */
function nmFlowerLabel(): LabelDesign {
  return nmLabel(
    [{ type: "text", x: 4, y: 0, w: 78, h: 6, text: "{{lab.profile}}", fontSize: 6.5, bold: true }],
    [{ type: "text", x: 4, y: 0, w: 93.6, h: 3, text: "Terpenes: {{lab.terpenes}}", fontSize: 6 }],
  );
}

/** Edibles, tinctures, and topicals: dose per serving, ingredients, allergens. */
function nmEdibleLabel(): LabelDesign {
  return nmLabel(
    [
      {
        type: "text",
        x: 4,
        y: 0,
        w: 78,
        h: 3.6,
        text: "THC {{item.thcPerServing}} per serving · {{item.servings}} servings · CBD {{item.cbdPerServing}}",
        fontSize: 7.5,
        bold: true,
      },
      { type: "text", x: 4, y: 0, w: 78, h: 5.6, text: "{{lab.profile}}", fontSize: 6, bold: true },
    ],
    [
      { type: "text", x: 4, y: 0, w: 93.6, h: 6, text: "Ingredients: {{item.ingredients}} {{item.allergens}}", fontSize: 5.5 },
      { type: "text", x: 4, y: 0, w: 93.6, h: 2.8, text: "Solvents and processing aids: {{item.solvents}}", fontSize: 5.5 },
      { type: "text", x: 4, y: 0, w: 93.6, h: 3, text: "{{item.refrigerate}}", fontSize: 6.5, bold: true },
    ],
  );
}

function transferLabel(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 50.8,
    elements: [
      el({ type: "text", x: 4, y: 3, w: 60, h: 6, text: "{{order.number}}", fontSize: 14, bold: true }),
      el({ type: "text", x: 64, y: 3, w: 33.6, h: 6, text: "{{order.position}}", fontSize: 12, bold: true, align: "right" }),
      el({ type: "text", x: 4, y: 10, w: 93.6, h: 4, text: "To {{order.customer}} · {{order.customerLicense}}", fontSize: 9 }),
      el({ type: "text", x: 4, y: 14.5, w: 93.6, h: 4, text: "Manifest {{order.manifest}} · ships {{order.shipDate}}", fontSize: 9 }),
      el({ type: "text", x: 4, y: 19, w: 93.6, h: 4, text: "{{item.name}} · {{package.quantity}} {{package.unit}}", fontSize: 9 }),
      el({ type: "barcode", x: 2, y: 24, w: 97.6, h: 13, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 4, y: 38, w: 93.6, h: 4.5, text: "{{package.tag}}", fontSize: 10, bold: true, align: "center" }),
      el({ type: "text", x: 4, y: 44, w: 93.6, h: 4, text: "From {{facility.name}} · {{facility.license}}", fontSize: 8 }),
    ],
  };
}


// ------------------------------------------------------------------ more product labels (New Mexico)

type Item = Omit<LabelElement, "id" | "y"> & { gap?: number };

/** Height a text element needs for typical data, with one spare line so longer real values still fit. */
function neededHeight(text: string, width: number, fontSize: number, bold: boolean, kind: LabelKind): number {
  const sample = fill(text, sampleValues(kind)).text;
  const { totalLines } = layoutText(sample, width, 1000, fontSize, bold);
  return (totalLines + 1) * lineHeightMm(fontSize);
}

/**
 * A full New Mexico product label at any width. Each block's height is worked out from its text so nothing is cut off;
 * the label is as tall as it needs to be, rounded up to a whole number of millimetres. Net quantity is last, in the bottom 30%.
 */
function nmProduct(opts: { widthMm: number; potency: Item[]; details: Item[]; heightMm?: number }): LabelDesign {
  seq = 0;
  const W = opts.widthMm;
  const m = 3.5;
  const inner = W - m * 2;
  const textW = inner - 15; // the state logo sits at the top right
  let y = 3;
  const out: LabelElement[] = [];
  const put = (e: Item, fixedW?: number) => {
    const w = fixedW ?? (e.w || inner);
    const h = e.h || neededHeight(e.text ?? "", w, e.fontSize ?? 8, Boolean(e.bold), "PRODUCT");
    const { gap, ...rest } = e;
    out.push(el({ ...rest, x: e.x || m, y, w, h }));
    y += h + (gap ?? 0.8);
  };
  put({ type: "text", x: m, w: textW, h: 0, text: "{{item.name}}", fontSize: 13, bold: true });
  out.push(el({ type: "image", x: W - m - 13, y: 3, w: 13, h: 13, role: "STATE_LOGO" }));
  put({ type: "text", x: m, w: textW, h: 0, text: "Total THC {{lab.thc}} · {{lab.thcMg}} per package", fontSize: 9.5, bold: true });
  y = Math.max(y, 17.5);
  for (const i of opts.potency) put(i);
  const textItems: Item[] = [
    { type: "text", x: m, w: inner, h: 0, text: "{{item.strain}} {{item.strainType}} · Lot {{package.lot}} · Harvest {{package.harvest}}", fontSize: 6 },
    { type: "text", x: m, w: inner, h: 0, text: "Directions: {{item.directions}}", fontSize: 6 },
    { type: "text", x: m, w: inner, h: 0, text: NM_WARNING, fontSize: 6.5, bold: true },
    { type: "text", x: m, w: inner, h: 0, text: NM_FDA, fontSize: 5.5 },
    ...opts.details,
    { type: "text", x: m, w: inner, h: 0, text: "Made by {{facility.name}} · License {{facility.license}} · Pesticides: {{item.pesticides}}", fontSize: 6 },
    { type: "text", x: m, w: inner, h: 0, text: "Manufactured {{package.created}} · Expires {{package.expires}} · Tested by {{lab.name}} {{lab.date}}", fontSize: 6 },
    { type: "text", x: m, w: inner, h: 0, text: "{{state.poisonCenter}}", fontSize: 6 },
  ];
  for (const i of textItems) put(i);
  out.push(el({ type: "barcode", x: 2, y: y + 0.5, w: W - 4, h: 8.5, value: "{{package.tag}}", format: "code128" }));
  y += 9.5;
  out.push(el({ type: "text", x: m, y, w: inner, h: 3.5, text: "{{package.tag}}", fontSize: 7, align: "center" }));
  y += 4;
  out.push(el({ type: "text", x: m, y, w: inner, h: 6, text: "Net wt. {{package.netQuantity}}", fontSize: 12, bold: true }));
  y += 7;
  const natural = Math.ceil(y);
  const H = Math.max(natural, opts.heightMm ?? 0);
  // Keep net quantity inside the bottom 30% even when the label has spare room.
  const net = out[out.length - 1];
  net.y = Math.max(net.y, H - 7.5);
  const code = out[out.length - 3];
  const tag = out[out.length - 2];
  tag.y = Math.min(tag.y + (net.y - (y - 7)), net.y - 4);
  code.y = Math.min(code.y + (net.y - (y - 7)), tag.y - 9.5);
  return { widthMm: W, heightMm: H, elements: out };
}

const PROFILE: Item = { type: "text", x: 3.5, w: 0, h: 0, text: "{{lab.profile}}", fontSize: 6.5, bold: true };
const TERPENES: Item = { type: "text", x: 3.5, w: 0, h: 0, text: "Terpenes: {{lab.terpenes}}", fontSize: 6 };
const SOLVENTS: Item = { type: "text", x: 3.5, w: 0, h: 0, text: "Solvents and processing aids: {{item.solvents}}", fontSize: 5.5 };
const INGREDIENTS: Item = { type: "text", x: 3.5, w: 0, h: 0, text: "Ingredients: {{item.ingredients}} {{item.allergens}}", fontSize: 5.5 };
const FRIDGE: Item = { type: "text", x: 3.5, w: 0, h: 0, text: "{{item.refrigerate}}", fontSize: 6.5, bold: true };
const SERVING: Item = { type: "text", x: 3.5, w: 0, h: 0, text: "THC {{item.thcPerServing}} per serving · {{item.servings}} servings · CBD {{item.cbdPerServing}}", fontSize: 7.5, bold: true };
const UNIT: Item = { type: "text", x: 3.5, w: 0, h: 0, text: "Unit: {{item.unitWeight}}", fontSize: 6.5 };

const productW = 76.2; // 3 inches

// ------------------------------------------------------------------ operations labels

function plantStake(): LabelDesign {
  seq = 0;
  return {
    widthMm: 50.8,
    heightMm: 50.8,
    elements: [
      el({ type: "qr", x: 9.4, y: 2, w: 32, h: 32, value: "{{plant.tag}}" }),
      el({ type: "text", x: 2, y: 35, w: 46.8, h: 5, text: "{{plant.tag}}", fontSize: 9, bold: true, align: "center" }),
      el({ type: "text", x: 2, y: 40.5, w: 46.8, h: 4, text: "{{plant.strain}} · {{plant.phase}}", fontSize: 7, align: "center" }),
      el({ type: "text", x: 2, y: 45, w: 46.8, h: 4, text: "{{plant.location}} · {{plant.planted}}", fontSize: 6, align: "center" }),
    ],
  };
}

function plantLarge(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 50.8,
    elements: [
      el({ type: "text", x: 4, y: 3, w: 93.6, h: 9, text: "{{plant.strain}}", fontSize: 20, bold: true }),
      el({ type: "text", x: 4, y: 14, w: 93.6, h: 5, text: "{{plant.phase}} · Room {{plant.location}} · Batch {{plant.batch}}", fontSize: 10 }),
      el({ type: "barcode", x: 2, y: 21, w: 97.6, h: 14, value: "{{plant.tag}}", format: "code128" }),
      el({ type: "text", x: 4, y: 36, w: 93.6, h: 5.5, text: "{{plant.tag}}", fontSize: 12, bold: true, align: "center" }),
      el({ type: "text", x: 4, y: 43, w: 60, h: 4, text: "Planted {{plant.planted}}", fontSize: 8 }),
      el({ type: "text", x: 64, y: 43, w: 33.6, h: 4, text: "{{facility.license}}", fontSize: 8, align: "right" }),
    ],
  };
}

function batchSmall(): LabelDesign {
  seq = 0;
  return {
    widthMm: 50.8,
    heightMm: 25.4,
    elements: [
      el({ type: "text", x: 2, y: 1.5, w: 46.8, h: 4.5, text: "{{batch.name}}", fontSize: 9, bold: true }),
      el({ type: "barcode", x: 0, y: 6.5, w: 50.8, h: 8, value: "{{batch.name}}", format: "code128" }),
      el({ type: "text", x: 2, y: 15.5, w: 46.8, h: 3.2, text: "{{batch.strain}} · {{batch.count}} plants", fontSize: 7 }),
      el({ type: "text", x: 2, y: 19.2, w: 46.8, h: 3, text: "Room {{batch.location}} · {{batch.started}}", fontSize: 6 }),
    ],
  };
}

function batchTray(): LabelDesign {
  seq = 0;
  return {
    widthMm: 76.2,
    heightMm: 50.8,
    elements: [
      el({ type: "text", x: 3, y: 2.5, w: 47, h: 6, text: "{{batch.name}}", fontSize: 13, bold: true }),
      el({ type: "text", x: 3, y: 9.5, w: 47, h: 4, text: "{{batch.strain}}", fontSize: 10, bold: true }),
      el({ type: "text", x: 3, y: 14.5, w: 47, h: 4, text: "{{batch.count}} plants · from {{batch.source}}", fontSize: 8 }),
      el({ type: "text", x: 3, y: 19, w: 47, h: 4, text: "Room {{batch.location}}", fontSize: 8 }),
      el({ type: "text", x: 3, y: 23.5, w: 47, h: 4, text: "Started {{batch.started}}", fontSize: 8 }),
      el({ type: "qr", x: 52, y: 3, w: 21, h: 21, value: "{{batch.name}}" }),
      el({ type: "line", x: 3, y: 38, w: 70.2, h: 0.3, stroke: 0.3 }),
      el({ type: "text", x: 3, y: 40, w: 70.2, h: 4, text: "{{facility.name}} · {{facility.license}}", fontSize: 7 }),
    ],
  };
}

function packageScan(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 50.8,
    elements: [
      el({ type: "text", x: 4, y: 2.5, w: 93.6, h: 6, text: "{{item.name}}", fontSize: 13, bold: true }),
      el({ type: "barcode", x: 2, y: 10, w: 97.6, h: 22, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 4, y: 33, w: 93.6, h: 7, text: "{{package.tag}}", fontSize: 16, bold: true, align: "center" }),
      el({ type: "text", x: 4, y: 42, w: 60, h: 4, text: "{{package.quantity}} {{package.unit}} · {{package.created}}", fontSize: 8 }),
      el({ type: "text", x: 64, y: 42, w: 33.6, h: 4, text: "Lab: {{lab.status}}", fontSize: 8, align: "right", bold: true }),
    ],
  };
}

function packageQuick(): LabelDesign {
  seq = 0;
  return {
    widthMm: 50.8,
    heightMm: 25.4,
    elements: [
      el({ type: "text", x: 2, y: 1.2, w: 46.8, h: 4, text: "{{item.name}}", fontSize: 8, bold: true }),
      el({ type: "barcode", x: 0, y: 5.8, w: 50.8, h: 9, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 2, y: 15.4, w: 46.8, h: 3.4, text: "{{package.tag}}", fontSize: 7, bold: true, align: "center" }),
      el({ type: "text", x: 2, y: 19.4, w: 46.8, h: 3, text: "{{package.quantity}} {{package.unit}} · Lab {{lab.status}}", fontSize: 6 }),
    ],
  };
}

function harvestBin(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 152.4,
    elements: [
      el({ type: "text", x: 5, y: 5, w: 91.6, h: 22, text: "{{item.strain}}", fontSize: 40, bold: true }),
      el({ type: "text", x: 5, y: 30, w: 91.6, h: 10, text: "{{item.name}}", fontSize: 18 }),
      el({ type: "line", x: 5, y: 43, w: 91.6, h: 0.8, stroke: 0.8 }),
      el({ type: "text", x: 5, y: 47, w: 91.6, h: 8, text: "{{package.quantity}} {{package.unit}}", fontSize: 26, bold: true }),
      el({ type: "text", x: 5, y: 58, w: 91.6, h: 6, text: "Harvested {{package.harvested}}", fontSize: 14 }),
      el({ type: "text", x: 5, y: 66, w: 91.6, h: 6, text: "Lot {{package.lot}}", fontSize: 14 }),
      el({ type: "barcode", x: 4, y: 78, w: 93.6, h: 30, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 5, y: 110, w: 91.6, h: 9, text: "{{package.tag}}", fontSize: 22, bold: true, align: "center" }),
      el({ type: "qr", x: 33.8, y: 121, w: 28, h: 28, value: "{{package.tag}}" }),
    ],
  };
}

function dryingRack(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 76.2,
    elements: [
      el({ type: "text", x: 4, y: 3, w: 93.6, h: 12, text: "{{item.strain}}", fontSize: 28, bold: true }),
      el({ type: "text", x: 4, y: 17, w: 93.6, h: 6, text: "Harvested {{package.harvested}} · Lot {{package.lot}}", fontSize: 12 }),
      el({ type: "text", x: 4, y: 25, w: 93.6, h: 6, text: "{{package.quantity}} {{package.unit}} · {{package.status}}", fontSize: 12 }),
      el({ type: "barcode", x: 2, y: 35, w: 97.6, h: 24, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 4, y: 61, w: 93.6, h: 8, text: "{{package.tag}}", fontSize: 18, bold: true, align: "center" }),
      el({ type: "text", x: 4, y: 70, w: 93.6, h: 4, text: "{{facility.name}} · {{facility.license}}", fontSize: 7 }),
    ],
  };
}

function sampleLabel(): LabelDesign {
  seq = 0;
  return {
    widthMm: 50.8,
    heightMm: 25.4,
    elements: [
      el({ type: "text", x: 2, y: 1, w: 46.8, h: 3.4, text: "LAB SAMPLE", fontSize: 7, bold: true }),
      el({ type: "text", x: 2, y: 4.6, w: 46.8, h: 3.6, text: "{{item.name}}", fontSize: 7.5, bold: true }),
      el({ type: "barcode", x: 0, y: 8.8, w: 50.8, h: 8, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 2, y: 17.4, w: 46.8, h: 3.2, text: "{{package.tag}}", fontSize: 6.5, bold: true, align: "center" }),
      el({ type: "text", x: 2, y: 20.8, w: 46.8, h: 3, text: "Lot {{package.lot}} · {{package.harvest}}", fontSize: 5.5 }),
    ],
  };
}

function quarantine(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 50.8,
    elements: [
      el({ type: "box", x: 1, y: 1, w: 99.6, h: 48.8, stroke: 1.2 }),
      el({ type: "text", x: 4, y: 3, w: 93.6, h: 10, text: "QUARANTINE · HOLD", fontSize: 22, bold: true, align: "center" }),
      el({ type: "text", x: 4, y: 14.5, w: 93.6, h: 5, text: "Do not sell, transfer or use. Lab: {{lab.status}}", fontSize: 10, bold: true, align: "center" }),
      el({ type: "text", x: 4, y: 21, w: 93.6, h: 5, text: "{{item.name}} · {{package.quantity}} {{package.unit}}", fontSize: 10, align: "center" }),
      el({ type: "barcode", x: 8, y: 28, w: 85.6, h: 12, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 4, y: 41, w: 93.6, h: 5, text: "{{package.tag}} · {{facility.license}}", fontSize: 9, bold: true, align: "center" }),
    ],
  };
}

function shippingBox(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 152.4,
    elements: [
      el({ type: "text", x: 5, y: 4, w: 55, h: 9, text: "{{order.number}}", fontSize: 24, bold: true }),
      el({ type: "text", x: 60, y: 4, w: 36.6, h: 9, text: "{{order.position}}", fontSize: 20, bold: true, align: "right" }),
      el({ type: "line", x: 5, y: 15, w: 91.6, h: 0.8, stroke: 0.8 }),
      el({ type: "text", x: 5, y: 18, w: 91.6, h: 4, text: "SHIP TO", fontSize: 8, bold: true }),
      el({ type: "text", x: 5, y: 23, w: 91.6, h: 14, text: "{{order.customer}}", fontSize: 22, bold: true }),
      el({ type: "text", x: 5, y: 39, w: 91.6, h: 6, text: "License {{order.customerLicense}}", fontSize: 12 }),
      el({ type: "text", x: 5, y: 48, w: 91.6, h: 6, text: "Manifest {{order.manifest}}", fontSize: 14, bold: true }),
      el({ type: "text", x: 5, y: 56, w: 91.6, h: 6, text: "Ship date {{order.shipDate}}", fontSize: 14 }),
      el({ type: "line", x: 5, y: 66, w: 91.6, h: 0.4, stroke: 0.4 }),
      el({ type: "text", x: 5, y: 69, w: 91.6, h: 6, text: "{{item.name}}", fontSize: 13, bold: true }),
      el({ type: "text", x: 5, y: 76, w: 91.6, h: 5, text: "{{package.quantity}} {{package.unit}}", fontSize: 11 }),
      el({ type: "barcode", x: 4, y: 85, w: 93.6, h: 28, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 5, y: 115, w: 91.6, h: 8, text: "{{package.tag}}", fontSize: 16, bold: true, align: "center" }),
      el({ type: "text", x: 5, y: 130, w: 91.6, h: 5, text: "FROM", fontSize: 8, bold: true }),
      el({ type: "text", x: 5, y: 135, w: 91.6, h: 6, text: "{{facility.name}}", fontSize: 12, bold: true }),
      el({ type: "text", x: 5, y: 142, w: 91.6, h: 5, text: "{{facility.license}}", fontSize: 10 }),
    ],
  };
}

function transferSmall(): LabelDesign {
  seq = 0;
  return {
    widthMm: 76.2,
    heightMm: 50.8,
    elements: [
      el({ type: "text", x: 3, y: 2, w: 45, h: 5, text: "{{order.number}}", fontSize: 11, bold: true }),
      el({ type: "text", x: 48, y: 2, w: 25.2, h: 5, text: "{{order.position}}", fontSize: 10, bold: true, align: "right" }),
      el({ type: "text", x: 3, y: 8, w: 70.2, h: 4, text: "To {{order.customer}}", fontSize: 8.5, bold: true }),
      el({ type: "text", x: 3, y: 12.5, w: 70.2, h: 3.4, text: "Manifest {{order.manifest}} · {{order.shipDate}}", fontSize: 7 }),
      el({ type: "barcode", x: 1.5, y: 17, w: 73.2, h: 17, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 3, y: 35, w: 70.2, h: 4.5, text: "{{package.tag}}", fontSize: 9, bold: true, align: "center" }),
      el({ type: "text", x: 3, y: 41, w: 70.2, h: 4, text: "{{item.name}} · {{package.quantity}} {{package.unit}}", fontSize: 7 }),
    ],
  };
}

/** The templates every facility starts with. A product label is only included for states with verified label rules. */
export function starterTemplates(state: string): StarterTemplate[] {
  const list: StarterTemplate[] = [
    { name: "Plant tag 2×1", kind: "PLANT", jurisdiction: null, design: plantTag() },
    { name: "Plant tag 2×2 (QR code)", kind: "PLANT", jurisdiction: null, design: plantStake() },
    { name: "Plant tag 4×2 (large, easy to read)", kind: "PLANT", jurisdiction: null, design: plantLarge() },
    { name: "Batch label 4×2", kind: "BATCH", jurisdiction: null, design: batchLabel() },
    { name: "Batch label 2×1", kind: "BATCH", jurisdiction: null, design: batchSmall() },
    { name: "Batch tray tag 3×2 (QR code)", kind: "BATCH", jurisdiction: null, design: batchTray() },
    { name: "Package label 4×2", kind: "PACKAGE", jurisdiction: null, design: packageLabel() },
    { name: "Package label 4×2 (big barcode)", kind: "PACKAGE", jurisdiction: null, design: packageScan() },
    { name: "Package label 2×1 (quick ID)", kind: "PACKAGE", jurisdiction: null, design: packageQuick() },
    { name: "Harvest bin label 4×6", kind: "PACKAGE", jurisdiction: null, design: harvestBin() },
    { name: "Drying rack label 4×3", kind: "PACKAGE", jurisdiction: null, design: dryingRack() },
    { name: "Lab sample label 2×1", kind: "PACKAGE", jurisdiction: null, design: sampleLabel() },
    { name: "Quarantine hold label 4×2", kind: "PACKAGE", jurisdiction: null, design: quarantine() },
    { name: "Transfer label 4×2", kind: "TRANSFER", jurisdiction: null, design: transferLabel() },
    { name: "Transfer label 3×2", kind: "TRANSFER", jurisdiction: null, design: transferSmall() },
    { name: "Shipping box label 4×6", kind: "TRANSFER", jurisdiction: null, design: shippingBox() },
  ];
  if (state.toUpperCase() === "NM") {
    const nm = (name: string, design: LabelDesign) => list.push({ name, kind: "PRODUCT", jurisdiction: "NM", design });
    nm("NM product label 4×4 (flower)", nmFlowerLabel());
    nm("NM product label 4×4 (edible)", nmEdibleLabel());
    nm("NM product label 3×4 (flower jar or bag)", nmProduct({ widthMm: productW, potency: [PROFILE, UNIT], details: [TERPENES] }));
    nm("NM product label 3×4 (pre-roll)", nmProduct({ widthMm: productW, potency: [PROFILE, UNIT], details: [TERPENES] }));
    nm("NM product label 3×4 (concentrate)", nmProduct({ widthMm: productW, potency: [PROFILE], details: [TERPENES, SOLVENTS] }));
    nm("NM product label 3×4 (vape cartridge)", nmProduct({ widthMm: productW, potency: [PROFILE], details: [TERPENES, INGREDIENTS, SOLVENTS] }));
    nm("NM product label 3×4 (edible)", nmProduct({ widthMm: productW, potency: [SERVING, PROFILE], details: [INGREDIENTS, SOLVENTS, FRIDGE] }));
    nm("NM product label 3×4 (tincture or topical)", nmProduct({ widthMm: productW, potency: [SERVING, PROFILE], details: [INGREDIENTS, SOLVENTS, FRIDGE] }));
  }
  return list;
}
