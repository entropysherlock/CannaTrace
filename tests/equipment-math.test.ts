import { describe, expect, it } from "vitest";
import { addDays, dueStatus, parseEveryDays, worst } from "@/lib/equipment-math";

describe("equipment schedules", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-20", 15)).toBe("2027-01-04");
    expect(addDays("2026-02-20", 10)).toBe("2026-03-02");
  });
  it("has no state without a schedule", () => {
    expect(dueStatus({ everyDays: null, lastOn: null, since: "2026-01-01", today: "2026-11-27" }).state).toBe("none");
  });
  it("is ok, soon, then overdue as the date approaches and passes", () => {
    const base = { everyDays: 90, lastOn: "2026-09-01", since: "2026-01-01" };
    expect(dueStatus({ ...base, today: "2026-10-01" })).toMatchObject({ state: "ok", nextDue: "2026-11-30", daysLeft: 60 });
    expect(dueStatus({ ...base, today: "2026-11-20" })).toMatchObject({ state: "soon", daysLeft: 10 });
    expect(dueStatus({ ...base, today: "2026-11-30" })).toMatchObject({ state: "soon", daysLeft: 0 });
    expect(dueStatus({ ...base, today: "2026-12-02" })).toMatchObject({ state: "overdue", daysLeft: -2 });
  });
  it("counts a never-done schedule from the day the equipment was added", () => {
    expect(dueStatus({ everyDays: 30, lastOn: null, since: "2026-10-01", today: "2026-11-27" }).state).toBe("overdue");
  });
  it("picks the worse state", () => {
    expect(worst("ok", "overdue")).toBe("overdue");
    expect(worst("none", "ok")).toBe("ok");
  });
  it("parses schedules typed by a person", () => {
    expect(parseEveryDays("", "x")).toBeNull();
    expect(parseEveryDays(" 90 ", "x")).toBe(90);
    expect(() => parseEveryDays("90 days", "x")).toThrow();
    expect(() => parseEveryDays("0", "x")).toThrow();
    expect(() => parseEveryDays("9999", "x")).toThrow();
  });
});
