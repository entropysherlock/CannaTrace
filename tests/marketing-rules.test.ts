import { describe, expect, it } from "vitest";
import { checkMessage, hasBlock, prepareBody, STOP_LINE } from "@/lib/marketing-rules";
import { isStopMessage } from "@/lib/sms";

const DISCLAIMER = "Please Consume Responsibly.";
const email = (body: string, subject = "A note") => checkMessage({ channel: "EMAIL", subject, body, disclaimer: DISCLAIMER });
const rules = (problems: ReturnType<typeof email>) => problems.filter((p) => p.severity === "block").map((p) => p.rule);

describe("marketing message check", () => {
  it("adds the required statement, and the stop line on texts, without changing the rest", () => {
    expect(prepareBody("EMAIL", "Hi Ana, 20% off flower this weekend. 21+ only.", DISCLAIMER)).toBe(`Hi Ana, 20% off flower this weekend. 21+ only.\n${DISCLAIMER}`);
    expect(prepareBody("SMS", "20% off this weekend", DISCLAIMER)).toBe(`20% off this weekend\n${DISCLAIMER}\n${STOP_LINE}`);
    const already = `Sale. 21+. ${DISCLAIMER} Reply STOP to end.`;
    expect(prepareBody("SMS", already, DISCLAIMER)).toBe(already);
  });
  it("passes an ordinary, compliant message", () => {
    const body = prepareBody("EMAIL", "Hi Ana, enjoy 20% off flower this weekend. For adults 21+.", DISCLAIMER);
    expect(email(body)).toEqual([]);
  });
  it("blocks a message missing the required statement", () => {
    expect(rules(email("20% off flower. For adults 21+."))).toContain("Required statement");
  });
  it("blocks wording aimed at minors, but not the keep-out-of-reach statement", () => {
    expect(rules(email(`Fun for the kids! ${DISCLAIMER}`))).toContain("Minors");
    expect(rules(email(`Cartoon-themed gummies. ${DISCLAIMER}`))).toContain("Minors");
    expect(rules(email(`For adults 21+. Keep out of reach of children. ${DISCLAIMER}`))).not.toContain("Minors");
  });
  it("blocks promoting over-consumption", () => {
    expect(rules(email(`All you can buy this weekend. ${DISCLAIMER}`))).toContain("Over-consumption");
    expect(rules(email(`Get so high with us. ${DISCLAIMER}`))).toContain("Over-consumption");
  });
  it("blocks giving cannabis away free, but allows free things that aren't cannabis", () => {
    expect(rules(email(`Free pre-roll with any purchase. ${DISCLAIMER}`))).toContain("Free cannabis");
    expect(rules(email(`Buy an eighth, get a free gram! ${DISCLAIMER}`))).toContain("Free cannabis");
    expect(rules(email(`Free parking and free coffee. ${DISCLAIMER}`))).not.toContain("Free cannabis");
    expect(rules(email(`Double points all weekend, 21+. ${DISCLAIMER}`))).toEqual([]);
  });
  it("warns about health claims and a missing age note without blocking", () => {
    const problems = email(`This cures anxiety. ${DISCLAIMER}`);
    expect(problems.map((p) => p.rule)).toEqual(expect.arrayContaining(["Health claims", "Age"]));
    expect(hasBlock(problems)).toBe(false);
  });
  it("needs a subject on email and a stop line on text", () => {
    expect(rules(email(`Hello 21+. ${DISCLAIMER}`, ""))).toContain("Subject");
    const text = checkMessage({ channel: "SMS", body: `Sale 21+. ${DISCLAIMER}`, disclaimer: DISCLAIMER });
    expect(rules(text)).toContain("Opt-out");
    expect(rules(checkMessage({ channel: "SMS", body: prepareBody("SMS", `Sale 21+.`, DISCLAIMER), disclaimer: DISCLAIMER }))).toEqual([]);
  });
  it("limits how long a text can be", () => {
    const long = checkMessage({ channel: "SMS", body: `${"x".repeat(700)} 21+ ${DISCLAIMER} Reply STOP`, disclaimer: DISCLAIMER });
    expect(rules(long)).toContain("Length");
  });
  it("recognizes stop words as carriers define them", () => {
    for (const w of ["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "END", "quit", "STOPALL"]) expect(isStopMessage(w)).toBe(true);
    for (const w of ["don't stop", "yes", "STOP texting me please"]) expect(isStopMessage(w)).toBe(false);
  });
});
