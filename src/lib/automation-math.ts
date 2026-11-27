import { InventoryError } from "./inventory-math";

export type AutomationMode = "OFF" | "ASK" | "AUTO";

/**
 * The kinds of work that can run on their own. `autoAllowed` is false for anything that changes
 * stock, sends something to a customer, or moves money: those can be switched to Ask me, never Auto,
 * until a person has watched them work for a while.
 */
export const AUTOMATION_KINDS = [
  { kind: "LABELS", label: "Make labels", detail: "Creates package and product labels and queues them for printing.", autoAllowed: true, practiceOnly: false, defaultMode: "AUTO" as AutomationMode },
  { kind: "BROWSER", label: "Take over the screen", detail: "Tally works the Leaf2Sale screens for you with a visible cursor, clicking and typing like a person. It acts as you, can't go outside Leaf2Sale, and hands back anything that deletes, disconnects or moves money.", autoAllowed: true, practiceOnly: false, defaultMode: "AUTO" as AutomationMode },
  { kind: "DRAFT_INVOICES", label: "Draft invoices", detail: "Prepares an invoice draft when an order is delivered. A person still reviews it.", autoAllowed: true, practiceOnly: false, defaultMode: "AUTO" as AutomationMode },
  { kind: "PRODUCTION", label: "Run production steps", detail: "Starts runs, adds inputs and finishes runs from a recipe. On Auto it only finishes runs, using the planned amount, in practice facilities; real facilities always wait for a person to enter the weight.", autoAllowed: true, practiceOnly: true, defaultMode: "AUTO" as AutomationMode },
  { kind: "CUSTOMER_MESSAGES", label: "Message customers", detail: "Drafts reminders and follow-ups to customers.", autoAllowed: false, practiceOnly: false, defaultMode: "ASK" as AutomationMode },
  { kind: "INVENTORY_CHANGES", label: "Change inventory", detail: "Adjusts, moves or writes off stock.", autoAllowed: false, practiceOnly: false, defaultMode: "ASK" as AutomationMode },
] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number]["kind"];

export const kindInfo = (kind: string) => AUTOMATION_KINDS.find((k) => k.kind === kind);
export const DEFAULT_CAP = 50;
export const MAX_CAP = 1000;

export function parseMode(raw: unknown): AutomationMode {
  const mode = String(raw ?? "").trim();
  if (mode !== "OFF" && mode !== "ASK" && mode !== "AUTO") throw new InventoryError("Pick Off, Ask me or Auto.");
  return mode;
}

export function parseKind(raw: unknown): AutomationKind {
  const info = kindInfo(String(raw ?? "").trim());
  if (!info) throw new InventoryError("That kind of work is not one of the automation settings.");
  return info.kind;
}

export function parseCap(raw: unknown): number {
  const text = String(raw ?? "").trim();
  if (text === "") return DEFAULT_CAP;
  if (!/^\d+$/.test(text)) throw new InventoryError("The hourly limit must be a whole number.");
  const n = Number(text);
  if (n < 1 || n > MAX_CAP) throw new InventoryError(`The hourly limit must be between 1 and ${MAX_CAP}.`);
  return n;
}

export type Decision = { action: "AUTO" | "ASK" | "BLOCKED"; reason: string };

/** What an agent may do right now for a kind of work. Pause and Off always stop it; Auto needs room under the cap. */
export function decide(input: { kind: string; practice?: boolean; paused: boolean; mode: AutomationMode | undefined; hourlyCap: number; doneLastHour: number }): Decision {
  const info = kindInfo(input.kind);
  if (!info) return { action: "BLOCKED", reason: "That kind of work is not set up for automation." };
  if (input.paused) return { action: "BLOCKED", reason: "Automation is paused." };
  const mode = input.mode ?? info.defaultMode;
  if (mode === "OFF") return { action: "BLOCKED", reason: `${info.label} is turned off.` };
  if (mode === "ASK") return { action: "ASK", reason: "Waiting for a person to approve." };
  if (info.practiceOnly && !input.practice) return { action: "ASK", reason: `${info.label} can only run on Auto in practice facilities, so a person approves here.` };
  if (!info.autoAllowed) return { action: "ASK", reason: `${info.label} can only be set to Ask me for now.` };
  if (input.doneLastHour >= input.hourlyCap) return { action: "ASK", reason: `Hit the limit of ${input.hourlyCap} per hour, so a person needs to approve.` };
  return { action: "AUTO", reason: "Set to Auto." };
}
