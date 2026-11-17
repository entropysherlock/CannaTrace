/** Shared label types. Pure data, safe to import from the browser and the server. */

export type LabelKind = "PLANT" | "BATCH" | "PACKAGE" | "PRODUCT" | "TRANSFER";

export const LABEL_KINDS: { kind: LabelKind; label: string; hint: string }[] = [
  { kind: "PLANT", label: "Plant tag", hint: "One tag per tracked plant." },
  { kind: "BATCH", label: "Batch label", hint: "One label per plant batch." },
  { kind: "PACKAGE", label: "Package label", hint: "Internal inventory label for a package." },
  { kind: "PRODUCT", label: "Product label", hint: "Retail-facing label for a finished product package." },
  { kind: "TRANSFER", label: "Transfer label", hint: "One label per package on a wholesale order." },
];

export type ElementType = "text" | "barcode" | "qr" | "image" | "line" | "box";
export type BarcodeFormat = "code128" | "datamatrix";

export type LabelElement = {
  id: string;
  type: ElementType;
  /** Position and size in millimetres from the top-left corner of the label. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text with {{field}} placeholders, for text elements. */
  text?: string;
  /** Font size in points. */
  fontSize?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  /** Data with {{field}} placeholders, for barcode and QR elements. */
  value?: string;
  format?: BarcodeFormat;
  /** Image as a data URL (PNG or JPEG), for image elements. */
  src?: string;
  /** What an image is for, so the checker can tell a state logo from decoration. */
  role?: "STATE_LOGO" | "LOGO";
  /** Line or border thickness in millimetres. */
  stroke?: number;
};

export type LabelDesign = {
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
};

/** One label's worth of data: field key to value. Null means the record has no value. */
export type LabelRecord = {
  /** What this label is for, shown in lists and errors (a tag, batch name, or order number). */
  ref: string;
  /** The id of the source record. */
  sourceId: string;
  values: Record<string, string | null>;
};

export type IssueSeverity = "block" | "warn" | "info";
export type IssueCategory = "MISSING_DATA" | "INCONSISTENT_DATA" | "BARCODE" | "LAYOUT" | "JURISDICTION";

export type LabelIssue = {
  code: string;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  /** What to do about it. */
  fix?: string;
  /** Which element the issue is about, when there is one. */
  elementId?: string;
  /** Which label (record ref) the issue is about, when it is about the data. */
  recordRef?: string;
  /** The regulation this comes from, for jurisdiction issues. */
  citation?: string;
  url?: string;
};
