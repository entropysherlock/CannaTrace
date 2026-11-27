/**
 * The marketing message checker. Every campaign and automatic message runs through it before anything is sent.
 *
 * It adds what is always required (the store's required statement; "Reply STOP" on texts) and blocks wording that
 * New Mexico's advertising rule (16.8.3.8 NMAC) or the rules on giving cannabis away forbid. It is an assist, not legal
 * advice: a store remains responsible for what it sends, and the full required warnings should be reviewed with
 * its own counsel or the Cannabis Control Division's guidance.
 */

export type Channel = "EMAIL" | "SMS";

export type Problem = { severity: "block" | "warn"; rule: string; message: string };

export const STOP_LINE = "Reply STOP to opt out.";

/** One text segment is 160 characters; carriers charge and sometimes filter by segment. */
export const SMS_SEGMENT = 160;
export const SMS_MAX = 640;

const MINORS = /\b(kids?|child(ren)?|teens?|teenagers?|minors?|juvenile|high[- ]?school|students?|cartoons?|toys?)\b/i;
const OVERCONSUMPTION = /\b(binge|chug|as much as you can|all you can|unlimited (grams?|flower|edibles?|dabs?)|get (so |super )?(high|wasted|stoned|baked|blasted)|smoke (all|every) ?(day|night)|non-?stop)\b/i;
const FREE_CANNABIS = /\bfree\s+(grams?|eighths?|\d+\s?g|joints?|pre-?rolls?|flower|edibles?|cannabis|weed|product|vapes?|carts?|cartridges?|ounces?|oz|dabs?|gummies|samples?)\b/i;
const HEALTH_CLAIMS = /\b(cures?|treats?|heals?|prevents?|diagnos\w*|fda[- ]approved|relieves? (pain|anxiety|depression)|medical benefits?)\b/i;
const AGE_NOTE = /(21\s*\+|21 (and|or) (older|over|up)|adults? only|adult[- ]use)/i;

const strip = (text: string, phrase: RegExp) => text.replace(phrase, " ");

/** Add what is always required, without changing the rest. Returns the text exactly as it will be sent. */
export function prepareBody(channel: Channel, body: string, disclaimer: string): string {
  let text = body.replace(/\r\n/g, "\n").trim();
  const has = (needle: string) => text.toLowerCase().includes(needle.toLowerCase());
  if (disclaimer.trim() && !has(disclaimer.trim())) text += `\n${disclaimer.trim()}`;
  if (channel === "SMS" && !/\bstop\b/i.test(text)) text += `\n${STOP_LINE}`;
  return text;
}

/** Everything wrong with a message, worst first. An empty list means it can be sent. */
export function checkMessage(input: { channel: Channel; subject?: string | null; body: string; disclaimer: string }): Problem[] {
  const problems: Problem[] = [];
  const full = `${input.subject ?? ""}\n${input.body}`;
  // "Keep out of reach of children" is a required kind of statement, not a message aimed at children.
  const forMinorsTest = strip(full, /keep out of (the )?reach of (children|kids)/gi);
  if (!input.body.trim()) problems.push({ severity: "block", rule: "Empty", message: "The message is empty." });
  if (input.disclaimer.trim() && !full.toLowerCase().includes(input.disclaimer.trim().toLowerCase()))
    problems.push({ severity: "block", rule: "Required statement", message: `New Mexico requires the statement "${input.disclaimer.trim()}" on cannabis marketing (16.8.3.8 NMAC).` });
  if (MINORS.test(forMinorsTest)) problems.push({ severity: "block", rule: "Minors", message: "Marketing may not use practices aimed at minors, so words about kids, teens, school, toys or cartoons are blocked (16.8.3.8 NMAC)." });
  if (OVERCONSUMPTION.test(full)) problems.push({ severity: "block", rule: "Over-consumption", message: "Marketing may not promote over-consumption, so wording like \"all you can\", \"binge\" or \"get high\" is blocked (16.8.3.8 NMAC)." });
  if (FREE_CANNABIS.test(full)) problems.push({ severity: "block", rule: "Free cannabis", message: "Giving cannabis away free isn't allowed in New Mexico (16.8.2 NMAC). Offer a discount or bonus points instead." });
  if (HEALTH_CLAIMS.test(full)) problems.push({ severity: "warn", rule: "Health claims", message: "Health claims like \"treats\" or \"relieves\" can't be backed up in an ad. Remove them unless you can support them." });
  if (!AGE_NOTE.test(full)) problems.push({ severity: "warn", rule: "Age", message: "Consider saying the message is for adults 21+." });
  if (input.channel === "SMS") {
    if (!/\bstop\b/i.test(input.body)) problems.push({ severity: "block", rule: "Opt-out", message: `Every text must tell people how to stop, like "${STOP_LINE}"` });
    if (input.body.length > SMS_MAX) problems.push({ severity: "block", rule: "Length", message: `Texts are limited to ${SMS_MAX} characters here. This one is ${input.body.length}.` });
    else if (input.body.length > SMS_SEGMENT * 2) problems.push({ severity: "warn", rule: "Length", message: `This text is ${input.body.length} characters, about ${Math.ceil(input.body.length / SMS_SEGMENT)} messages. Shorter texts are filtered less.` });
  } else if (!input.subject?.trim()) problems.push({ severity: "block", rule: "Subject", message: "Add a subject line." });
  return problems.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "block" ? -1 : 1));
}

export const hasBlock = (problems: Problem[]) => problems.some((p) => p.severity === "block");
