import { code128Problem, encode, MIN_MODULE_MM, placement, BarcodeError } from "./barcode";
import { fieldDef, fill, placeholders } from "./fields";
import { elementsShowing, labelPackFor, normalizeWords, type LabelRulePack } from "./jurisdictions";
import { layoutText } from "./text";
import type { LabelDesign, LabelIssue, LabelKind, LabelRecord } from "./types";

/** Fields that identify a regulated item. A label missing one of these must not print. */
const CRITICAL_FIELDS = new Set(["package.tag", "plant.tag", "batch.name", "facility.license", "lab.thc", "order.number", "order.manifest"]);

/** Scanners need bars at least this tall, in millimetres. */
const MIN_1D_HEIGHT_MM = 5;
const MAX_LABEL_MM = 300;

export type ValidationResult = {
  issues: LabelIssue[];
  blocked: boolean;
  pack: LabelRulePack | null;
  /** Rules CannaTrace checked automatically, and ones a person still has to confirm. */
  checkedRules: number;
  manualRules: number;
};

/** Checks on the layout itself, before any record is filled in. */
export function checkDesign(design: LabelDesign, kind: LabelKind): LabelIssue[] {
  const issues: LabelIssue[] = [];
  const { widthMm: W, heightMm: H } = design;
  if (!(W > 0 && H > 0) || W > MAX_LABEL_MM || H > MAX_LABEL_MM) {
    issues.push({ code: "SIZE", severity: "block", category: "LAYOUT", message: `The label size ${W} × ${H} mm is not usable.`, fix: `Use a width and height between 1 and ${MAX_LABEL_MM} mm.` });
  }
  if (design.elements.length === 0) {
    issues.push({ code: "EMPTY", severity: "block", category: "LAYOUT", message: "The label has nothing on it.", fix: "Add text or a barcode." });
  }
  for (const el of design.elements) {
    if (el.w <= 0 || el.h <= 0 || el.x < 0 || el.y < 0 || el.x + el.w > W + 0.01 || el.y + el.h > H + 0.01) {
      issues.push({ code: "OFF_LABEL", severity: "block", category: "LAYOUT", elementId: el.id, message: `An element (${el.type}) runs off the edge of the label.`, fix: "Move or shrink it so it sits fully inside the label." });
    }
    const source = el.type === "text" ? el.text : el.type === "barcode" || el.type === "qr" ? el.value : undefined;
    for (const key of placeholders(source)) {
      const def = fieldDef(key);
      if (!def) {
        issues.push({ code: "UNKNOWN_FIELD", severity: "block", category: "LAYOUT", elementId: el.id, message: `{{${key}}} is not a field CannaTrace knows.`, fix: "Pick a field from the list instead of typing it." });
      } else if (!def.kinds.includes(kind)) {
        issues.push({ code: "WRONG_FIELD", severity: "block", category: "LAYOUT", elementId: el.id, message: `"${def.label}" isn't available on this label type.`, fix: "Remove it or use a template made for that record type." });
      }
    }
    if (el.type === "text" && (el.fontSize ?? 8) < 4) {
      issues.push({ code: "TINY_TEXT", severity: "warn", category: "LAYOUT", elementId: el.id, message: `Text at ${el.fontSize} pt is very hard to read.`, fix: "Use 5 pt or larger." });
    }
    if (el.type === "barcode" || el.type === "qr") {
      if (!el.value?.trim()) {
        issues.push({ code: "BARCODE_EMPTY", severity: "block", category: "BARCODE", elementId: el.id, message: "A barcode has no data.", fix: "Set it to a field, such as the package tag." });
      } else if (placeholders(el.value).length === 0) {
        issues.push({ code: "BARCODE_STATIC", severity: "warn", category: "BARCODE", elementId: el.id, message: "A barcode holds fixed text, so every label gets the same code.", fix: "Use a field such as {{package.tag}} so each label scans to its own record." });
      }
      if (el.type === "barcode" && (el.format ?? "code128") === "code128" && el.h < MIN_1D_HEIGHT_MM) {
        issues.push({ code: "BARCODE_SHORT", severity: "warn", category: "BARCODE", elementId: el.id, message: `The barcode is only ${el.h} mm tall; handheld scanners miss short bars.`, fix: `Make it at least ${MIN_1D_HEIGHT_MM} mm tall.` });
      }
    }
    if (el.type === "image" && el.src && !/^data:image\/(png|jpe?g);base64,/.test(el.src)) {
      issues.push({ code: "IMAGE_TYPE", severity: "block", category: "LAYOUT", elementId: el.id, message: "Images must be PNG or JPEG.", fix: "Upload the image again as PNG or JPEG." });
    }
  }
  return issues;
}

/** Checks for one record: missing values, data that contradicts itself, barcodes that won't scan, text that won't fit. */
export function checkRecord(design: LabelDesign, kind: LabelKind, record: LabelRecord): LabelIssue[] {
  const issues: LabelIssue[] = [];
  const v = record.values;
  const ref = record.ref;
  const seen = new Set<string>();
  for (const el of design.elements) {
    if (el.type !== "text" && el.type !== "barcode" && el.type !== "qr") continue;
    const filled = fill(el.type === "text" ? el.text : el.value, v);
    for (const key of filled.missing) {
      if (seen.has(key)) continue;
      seen.add(key);
      const def = fieldDef(key);
      const critical = CRITICAL_FIELDS.has(key);
      const labMsg = key.startsWith("lab.") && v["_lab.status"] !== "PASS" ? " There is no passed lab result for it, and CannaTrace never prints potency from an unpassed test." : "";
      issues.push({
        code: "MISSING",
        severity: critical ? "block" : "warn",
        category: "MISSING_DATA",
        recordRef: ref,
        elementId: el.id,
        message: `${ref}: "${def?.label ?? key}" is empty.${labMsg}`,
        fix: key.startsWith("lab.") ? "Record a passed lab result on the package first." : "Fill it in on the record itself, then print again. Labels can't be typed over.",
      });
    }
    if (el.type === "text") {
      const { overflow } = layoutText(filled.text, el.w, el.h, el.fontSize ?? 8, el.bold);
      if (overflow) {
        issues.push({ code: "OVERFLOW", severity: "warn", category: "LAYOUT", recordRef: ref, elementId: el.id, message: `${ref}: text "${filled.text.slice(0, 40)}" doesn't fit its box and will be cut off.`, fix: "Make the box bigger or the text smaller." });
      }
    } else if (filled.text) {
      const format = el.type === "qr" ? "qrcode" : (el.format ?? "code128");
      const problem = format === "code128" ? code128Problem(filled.text) : null;
      if (problem) {
        issues.push({ code: "BARCODE_DATA", severity: "block", category: "BARCODE", recordRef: ref, elementId: el.id, message: `${ref}: ${problem}` });
        continue;
      }
      try {
        const sym = encode(format, filled.text);
        const { module: unit } = placement(sym, el);
        if (unit < 0.19) {
          issues.push({ code: "BARCODE_DENSE", severity: "block", category: "BARCODE", recordRef: ref, elementId: el.id, message: `${ref}: the barcode's thinnest bar would be ${unit.toFixed(2)} mm, too thin for label printers to print cleanly.`, fix: `Widen the barcode to at least ${Math.ceil((el.w * MIN_MODULE_MM) / unit)} mm or shorten the data.` });
        } else if (unit < MIN_MODULE_MM) {
          issues.push({ code: "BARCODE_TIGHT", severity: "warn", category: "BARCODE", recordRef: ref, elementId: el.id, message: `${ref}: the barcode's thinnest bar is ${unit.toFixed(2)} mm. A 203 dpi printer may smear it.`, fix: `Widen it to about ${Math.ceil((el.w * MIN_MODULE_MM) / unit)} mm for reliable scans.` });
        }
      } catch (e) {
        issues.push({ code: "BARCODE_DATA", severity: "block", category: "BARCODE", recordRef: ref, elementId: el.id, message: `${ref}: ${e instanceof BarcodeError ? e.message : "the barcode could not be made."}` });
      }
    }
  }

  // Data that contradicts itself or makes the label wrong to print.
  const pkgStatus = v["_package.status"];
  if (pkgStatus) {
    if (pkgStatus === "DESTROYED" || pkgStatus === "FINISHED") {
      issues.push({ code: "PACKAGE_GONE", severity: "block", category: "INCONSISTENT_DATA", recordRef: ref, message: `${ref} is ${pkgStatus.toLowerCase()}, so it should not get a new label.` });
    } else if (pkgStatus === "ON_HOLD" || pkgStatus === "QUARANTINE") {
      issues.push({ code: "PACKAGE_HELD", severity: kind === "PRODUCT" || kind === "TRANSFER" ? "block" : "warn", category: "INCONSISTENT_DATA", recordRef: ref, message: `${ref} is ${pkgStatus.toLowerCase().replace("_", " ")}.`, fix: "Release the hold before printing sale or transfer labels." });
    }
  }
  const qty = v["_package.quantity"];
  if (qty !== undefined && qty !== null && Number(qty) <= 0) {
    issues.push({ code: "PACKAGE_EMPTY", severity: "block", category: "INCONSISTENT_DATA", recordRef: ref, message: `${ref} has nothing left in it.` });
  }
  const lab = v["_lab.status"];
  if (kind === "PRODUCT") {
    if (lab === "FAIL") issues.push({ code: "LAB_FAILED", severity: "block", category: "INCONSISTENT_DATA", recordRef: ref, message: `${ref} failed lab testing and can't be labeled for sale.` });
    else if (lab !== "PASS") issues.push({ code: "LAB_MISSING", severity: "block", category: "INCONSISTENT_DATA", recordRef: ref, message: `${ref} has no passed lab result yet${lab === "PENDING" ? " (the test is still pending)" : ""}.`, fix: "Retail product labels need potency from a passed test." });
  }
  const plantStatus = v["_plant.status"];
  if (plantStatus && plantStatus !== "ACTIVE") {
    issues.push({ code: "PLANT_GONE", severity: "warn", category: "INCONSISTENT_DATA", recordRef: ref, message: `Plant ${ref} is ${plantStatus.toLowerCase()}.` });
  }
  return issues;
}

/** Checks the design against a state's verified label rules. */
export function checkJurisdiction(design: LabelDesign, kind: LabelKind, state: string | null | undefined): { issues: LabelIssue[]; pack: LabelRulePack | null; checked: number; manual: number } {
  const issues: LabelIssue[] = [];
  if (!state) {
    issues.push({ code: "NO_STATE", severity: "info", category: "JURISDICTION", message: "This template isn't tied to a state, so no state label rules were checked." });
    return { issues, pack: null, checked: 0, manual: 0 };
  }
  const pack = labelPackFor(state);
  if (!pack) {
    issues.push({ code: "STATE_UNSUPPORTED", severity: "warn", category: "JURISDICTION", message: `CannaTrace has no verified label rules for ${state.toUpperCase()} yet. Nothing was checked against ${state.toUpperCase()} law.`, fix: "Have your compliance lead review this label before using it for sale." });
    return { issues, pack: null, checked: 0, manual: 0 };
  }
  if (!pack.appliesTo.includes(kind)) {
    issues.push({ code: "KIND_UNSUPPORTED", severity: "info", category: "JURISDICTION", message: `${pack.name} covers ${pack.appliesTo.join(", ").toLowerCase()} labels. This label type has no verified ${pack.state} rules, so only data and barcode checks ran.`, citation: pack.source, url: pack.url });
    return { issues, pack, checked: 0, manual: 0 };
  }
  const hasQr = design.elements.some((el) => el.type === "qr");
  const allText = design.elements.filter((el) => el.type === "text");
  let checked = 0;
  let manual = 0;
  for (const rule of pack.rules) {
    const base = { category: "JURISDICTION" as const, citation: rule.citation, url: pack.url };
    const c = rule.check;
    if (c.type === "manual") {
      manual++;
      issues.push({ ...base, code: `RULE_${rule.id}`, severity: "info", message: `Confirm by hand: ${rule.title}.` });
      continue;
    }
    checked++;
    if (c.type === "field") {
      const els = elementsShowing(design.elements, c.field);
      if (els.length === 0) {
        if (rule.qrAllowed && hasQr) {
          manual++;
          issues.push({ ...base, code: `RULE_${rule.id}`, severity: "info", message: `${rule.title} isn't printed. It may be on the page your QR code opens; CannaTrace can't check that page.` });
        } else {
          issues.push({ ...base, code: `RULE_${rule.id}`, severity: "block", message: `Missing: ${rule.title}.`, fix: `Add a text element showing {{${c.field}}}.` });
        }
        continue;
      }
      const textEls = els.filter((el) => el.type === "text");
      if (c.bold && !textEls.some((el) => el.bold)) {
        issues.push({ ...base, code: `RULE_${rule.id}_BOLD`, severity: "block", elementId: els[0].id, message: `${rule.title}: it must be bold.`, fix: "Turn on bold for that text." });
      }
      if (c.bottomFraction && !textEls.some((el) => el.y >= design.heightMm * (1 - c.bottomFraction!) - 0.01)) {
        issues.push({ ...base, code: `RULE_${rule.id}_PLACE`, severity: "warn", elementId: els[0].id, message: `${rule.title}: it isn't in the bottom ${Math.round(c.bottomFraction * 100)}% of this label.`, fix: "Move it lower, unless your display panel is a different part of the package." });
      }
    } else if (c.type === "statement") {
      const want = normalizeWords(c.text);
      const match = allText.find((el) => normalizeWords(el.text ?? "").includes(want));
      if (!match) {
        if (rule.qrAllowed && hasQr) {
          manual++;
          issues.push({ ...base, code: `RULE_${rule.id}`, severity: "info", message: `${rule.title} isn't printed. It may be on the page your QR code opens; CannaTrace can't check that page.` });
        } else {
          issues.push({ ...base, code: `RULE_${rule.id}`, severity: "block", message: `Missing or reworded: ${rule.title}. It must read exactly: "${c.text}"`, fix: "Add a text element with this exact wording." });
        }
      } else if (c.bold && !match.bold) {
        issues.push({ ...base, code: `RULE_${rule.id}_BOLD`, severity: "block", elementId: match.id, message: `${rule.title}: it must be bold.`, fix: "Turn on bold for that text." });
      }
    } else if (c.type === "logo") {
      const logos = design.elements.filter((el) => el.type === "image" && el.role === "STATE_LOGO");
      if (logos.length === 0) {
        issues.push({ ...base, code: `RULE_${rule.id}`, severity: "block", message: `Missing: ${rule.title}.`, fix: "Add an image, upload the logo file from the Cannabis Control Division, and mark it as the state logo." });
      } else if (!logos.some((el) => el.src)) {
        issues.push({ ...base, code: `RULE_${rule.id}_FILE`, severity: "block", elementId: logos[0].id, message: "The state logo spot has no image uploaded yet.", fix: "Upload the logo file from the Cannabis Control Division." });
      } else if (!logos.some((el) => Math.min(el.w, el.h) >= c.minMm - 0.01)) {
        issues.push({ ...base, code: `RULE_${rule.id}_SIZE`, severity: "block", elementId: logos[0].id, message: `${rule.title}: it's smaller than ${c.minMm} mm on a side.`, fix: `Make it at least ${c.minMm} × ${c.minMm} mm.` });
      } else {
        issues.push({ ...base, code: `RULE_${rule.id}_ART`, severity: "info", message: "CannaTrace checked the logo's size, not that the uploaded image is the official artwork." });
      }
    }
  }
  return { issues, pack, checked, manual };
}

/** Run every check. Printing is allowed only when nothing is blocking. */
export function validateLabels(design: LabelDesign, kind: LabelKind, state: string | null | undefined, records: LabelRecord[]): ValidationResult {
  const design1 = checkDesign(design, kind);
  const juris = checkJurisdiction(design, kind, state);
  const perRecord = records.flatMap((r) => checkRecord(design, kind, r));
  const issues = [...design1, ...perRecord, ...juris.issues];
  return { issues, blocked: issues.some((i) => i.severity === "block"), pack: juris.pack, checkedRules: juris.checked, manualRules: juris.manual };
}
