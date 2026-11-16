export type Role =
  | "OWNER"
  | "MANAGER"
  | "INVENTORY"
  | "CULTIVATION"
  | "SALES"
  | "BUDTENDER"
  | "READ_ONLY";

export type Permission =
  | "inventory.view"
  | "inventory.write"
  | "inventory.adjust"
  | "catalog.manage"
  | "cultivation.view"
  | "cultivation.write"
  | "sales.write"
  | "pos.use"
  | "settings.manage"
  | "users.manage"
  | "audit.view";

const ALL: Permission[] = [
  "inventory.view",
  "inventory.write",
  "inventory.adjust",
  "catalog.manage",
  "cultivation.view",
  "cultivation.write",
  "sales.write",
  "pos.use",
  "settings.manage",
  "users.manage",
  "audit.view",
];

const MATRIX: Record<Role, Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== "users.manage"),
  INVENTORY: ["inventory.view", "inventory.write", "inventory.adjust", "catalog.manage", "cultivation.view", "audit.view"],
  CULTIVATION: ["inventory.view", "cultivation.view", "cultivation.write"],
  SALES: ["inventory.view", "sales.write"],
  BUDTENDER: ["inventory.view", "pos.use"],
  READ_ONLY: ["inventory.view", "cultivation.view", "audit.view"],
};

export const ROLES = Object.keys(MATRIX) as Role[];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  INVENTORY: "Inventory",
  CULTIVATION: "Cultivation",
  SALES: "Sales",
  BUDTENDER: "Budtender",
  READ_ONLY: "Read-only",
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
