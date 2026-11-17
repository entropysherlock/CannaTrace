import { NM_LABEL_PACK } from "./jurisdictions";
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

function nmProductLabel(): LabelDesign {
  seq = 0;
  return {
    widthMm: 101.6,
    heightMm: 76.2,
    elements: [
      el({ type: "text", x: 4, y: 3, w: 78, h: 6, text: "{{item.name}}", fontSize: 13, bold: true }),
      el({ type: "image", x: 84.6, y: 3, w: 13, h: 13, role: "STATE_LOGO" }),
      el({ type: "text", x: 4, y: 10, w: 78, h: 4.5, text: "Total THC {{lab.thc}}", fontSize: 10, bold: true }),
      el({ type: "text", x: 4, y: 15, w: 78, h: 3.5, text: "Tested by {{lab.name}} on {{lab.date}}", fontSize: 7 }),
      el({ type: "text", x: 4, y: 19.5, w: 93.6, h: 9, text: NM_WARNING, fontSize: 6, bold: true }),
      el({ type: "text", x: 4, y: 29.5, w: 93.6, h: 3, text: "This product is not approved by the FDA to treat, cure, or prevent any disease.", fontSize: 6 }),
      el({ type: "text", x: 4, y: 33, w: 93.6, h: 3, text: "Made by {{facility.name}} · License {{facility.license}}", fontSize: 6 }),
      el({ type: "text", x: 4, y: 36.5, w: 93.6, h: 3, text: "Manufactured {{package.created}} · Lot {{package.lot}}", fontSize: 6 }),
      el({ type: "barcode", x: 2, y: 41, w: 97.6, h: 11, value: "{{package.tag}}", format: "code128" }),
      el({ type: "text", x: 4, y: 52.5, w: 93.6, h: 3.5, text: "{{package.tag}}", fontSize: 7, align: "center" }),
      el({ type: "text", x: 4, y: 60, w: 93.6, h: 6, text: "Net wt. {{package.quantity}} {{package.unit}}", fontSize: 12, bold: true }),
    ],
  };
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

/** The templates every facility starts with. A product label is only included for states with verified label rules. */
export function starterTemplates(state: string): StarterTemplate[] {
  const list: StarterTemplate[] = [
    { name: "Plant tag 2×1", kind: "PLANT", jurisdiction: null, design: plantTag() },
    { name: "Batch label 4×2", kind: "BATCH", jurisdiction: null, design: batchLabel() },
    { name: "Package label 4×2", kind: "PACKAGE", jurisdiction: null, design: packageLabel() },
    { name: "Transfer label 4×2", kind: "TRANSFER", jurisdiction: null, design: transferLabel() },
  ];
  if (state.toUpperCase() === "NM") list.push({ name: "NM product label 4×3", kind: "PRODUCT", jurisdiction: "NM", design: nmProductLabel() });
  return list;
}
