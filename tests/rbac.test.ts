import { describe, expect, it } from "vitest";
import { can } from "../src/lib/rbac";

describe("role permissions", () => {
  it("lets only owners manage users", () => {
    expect(can("OWNER", "users.manage")).toBe(true);
    expect(can("MANAGER", "users.manage")).toBe(false);
  });
  it("keeps read-only users from writing", () => {
    expect(can("READ_ONLY", "inventory.view")).toBe(true);
    expect(can("READ_ONLY", "inventory.write")).toBe(false);
    expect(can("READ_ONLY", "inventory.adjust")).toBe(false);
  });
  it("keeps budtenders out of adjustments", () => {
    expect(can("BUDTENDER", "pos.use")).toBe(true);
    expect(can("BUDTENDER", "inventory.adjust")).toBe(false);
  });
});
