import { describe, expect, it } from "vitest";
import { decide, parseCap, parseKind, parseMode } from "@/lib/automation-math";

const base = { kind: "LABELS", paused: false, mode: "AUTO" as const, hourlyCap: 50, doneLastHour: 0 };
describe("decide", () => {
  it("runs on its own when set to Auto and under the cap", () => expect(decide(base).action).toBe("AUTO"));
  it("is blocked by the pause switch whatever the setting", () => expect(decide({ ...base, paused: true }).action).toBe("BLOCKED"));
  it("is blocked when off or never set", () => {
    expect(decide({ ...base, mode: "OFF" }).action).toBe("BLOCKED");
    expect(decide({ ...base, mode: undefined }).action).toBe("BLOCKED");
  });
  it("asks when set to Ask me", () => expect(decide({ ...base, mode: "ASK" }).action).toBe("ASK"));
  it("falls back to asking once the hourly cap is reached", () => {
    expect(decide({ ...base, doneLastHour: 49 }).action).toBe("AUTO");
    expect(decide({ ...base, doneLastHour: 50 }).action).toBe("ASK");
  });
  it("never runs risky kinds on Auto, even if stored that way", () => {
    for (const kind of ["PRODUCTION", "CUSTOMER_MESSAGES", "INVENTORY_CHANGES"]) expect(decide({ ...base, kind }).action).toBe("ASK");
  });
  it("blocks unknown kinds", () => expect(decide({ ...base, kind: "NOPE" }).action).toBe("BLOCKED"));
});
describe("parsing", () => {
  it("validates mode, kind and cap", () => {
    expect(parseMode("ASK")).toBe("ASK");
    expect(() => parseMode("auto")).toThrow();
    expect(parseKind("LABELS")).toBe("LABELS");
    expect(() => parseKind("X")).toThrow();
    expect(parseCap("")).toBe(50);
    expect(parseCap("25")).toBe(25);
    for (const bad of ["0", "-1", "1.5", "5000", "abc"]) expect(() => parseCap(bad)).toThrow();
  });
});
