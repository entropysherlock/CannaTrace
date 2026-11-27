/**
 * Take over mode: an agent that works the Leaf2Sale screens the way a person would, with a visible cursor.
 * This file is the rules both sides share: what a page looks like to the agent, which actions exist, and
 * which ones the agent may never do on its own. No browser or network in here, so it can be tested.
 */

export const MAX_STEPS = 40;
export const MAX_ELEMENTS = 160;
/** Dropdowns like the room list can be long; the agent has to see all of them. */
export const MAX_OPTIONS = 80;

export type PageElement = {
  i: number;
  tag: string; // a, button, input, select, textarea, summary, option (an entry in a search pick-list)
  label: string;
  type?: string; // input type
  value?: string;
  href?: string;
  options?: string[];
  disabled?: boolean;
};

export type Action =
  | { type: "click"; i: number }
  | { type: "type"; i: number; text: string; submit?: boolean }
  | { type: "select"; i: number; value: string }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "navigate"; path: string }
  | { type: "wait" }
  | { type: "ask"; message: string }
  | { type: "done"; message: string };

/** Buttons and links the agent must hand back to a person: they delete, disconnect, move money or leave. */
const RISKY = /\b(delete|remove|disconnect|sign ?out|log ?out|erase|destroy|void|refund|charge|pay|purge|wipe|terminate|revoke|deactivate|cancel (this )?(run|order|invoice))\b/i;
/** Places the agent never goes by itself. */
const BLOCKED_PATH = /^\/(signout|login|reset|invite|oauth|api|link|setup|account)(\/|$|\?)/i;

export function isRiskyLabel(label: string): boolean {
  return RISKY.test(label);
}

export function isSafePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !BLOCKED_PATH.test(path);
}

const text = (v: unknown, max: number) => String(v ?? "").slice(0, max);

/** Turn whatever the model sent into one well-formed action, or null when it makes no sense. */
export function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const index = Number(r.i);
  const hasIndex = Number.isInteger(index) && index >= 0;
  switch (r.type) {
    case "click":
      return hasIndex ? { type: "click", i: index } : null;
    case "type":
      return hasIndex ? { type: "type", i: index, text: text(r.text, 500), submit: r.submit === true } : null;
    case "select":
      return hasIndex ? { type: "select", i: index, value: text(r.value, 200) } : null;
    case "scroll":
      return { type: "scroll", direction: r.direction === "up" ? "up" : "down" };
    case "navigate":
      return typeof r.path === "string" && r.path ? { type: "navigate", path: r.path.slice(0, 300) } : null;
    case "wait":
      return { type: "wait" };
    case "ask":
      return { type: "ask", message: text(r.message, 400) || "I need your help to continue." };
    case "done":
      return { type: "done", message: text(r.message, 600) || "Done." };
    default:
      return null;
  }
}

export type Checked = { action: Action } | { stop: string };

/**
 * The last check before anything is clicked, run in the browser against the real page. Anything risky, a
 * password box, or an off-limits address becomes a request for the person to do that step themselves.
 */
export function checkAction(action: Action, elements: PageElement[]): Checked {
  if (action.type === "navigate") return isSafePath(action.path) ? { action } : { stop: `I won't go to ${action.path} by myself. Please open it yourself if you want me to continue there.` };
  if (action.type === "click" || action.type === "type" || action.type === "select") {
    const el = elements.find((e) => e.i === action.i);
    if (!el) return { stop: "The page changed and I lost track of what to press. Tell me to try again." };
    if (el.disabled) return { stop: `"${el.label || el.tag}" is greyed out right now.` };
    if (action.type === "click" && isRiskyLabel(el.label)) return { stop: `Please press "${el.label}" yourself. I don't do that one for you.` };
    if (action.type === "click" && el.href && !isSafePath(new URL(el.href, "http://x").pathname) && el.href.startsWith("/")) return { stop: `I won't open ${el.href} by myself.` };
    if (action.type === "type" && (el.type === "password" || /password|passcode|one-time|2fa|verification code|card number|cvv|ssn/i.test(el.label))) return { stop: `Please fill in "${el.label}" yourself. I never type passwords, codes or card details.` };
    if (action.type === "type" && !["input", "textarea"].includes(el.tag)) return { stop: "That isn't a box I can type in." };
    if (action.type === "select" && el.tag !== "select") return { stop: "That isn't a dropdown." };
  }
  return { action };
}

/** One line per element for the model: [index] tag "label" plus the useful extras. */
export function describeElements(elements: PageElement[]): string {
  return elements
    .slice(0, MAX_ELEMENTS)
    .map((e) => {
      const bits = [`[${e.i}] ${e.tag}${e.type && e.type !== "text" ? `(${e.type})` : ""}`, JSON.stringify(e.label.slice(0, 80))];
      if (e.value) bits.push(`value=${JSON.stringify(e.value.slice(0, 60))}`);
      if (e.options?.length) bits.push(`options=${JSON.stringify(e.options.slice(0, MAX_OPTIONS))}`);
      if (e.href) bits.push(`-> ${e.href.slice(0, 80)}`);
      if (e.disabled) bits.push("(disabled)");
      return bits.join(" ");
    })
    .join("\n");
}

/** The same action over and over means the agent is stuck, not working. */
export function isStuck(history: { action: Action }[], times = 3): boolean {
  if (history.length < times) return false;
  const last = JSON.stringify(history[history.length - 1].action);
  return history.slice(-times).every((h) => JSON.stringify(h.action) === last);
}
