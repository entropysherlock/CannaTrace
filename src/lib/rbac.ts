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
  | "manufacturing.write"
  | "cultivation.view"
  | "cultivation.write"
  | "sales.view"
  | "sales.write"
  | "pos.use"
  | "pos.manage"
  | "settings.manage"
  | "users.manage"
  | "audit.view"
  | "compliance.view"
  | "compliance.manage"
  | "reports.view"
  | "integrations.manage";

const ALL: Permission[] = [
  "inventory.view",
  "inventory.write",
  "inventory.adjust",
  "catalog.manage",
  "manufacturing.write",
  "cultivation.view",
  "cultivation.write",
  "sales.view",
  "sales.write",
  "pos.use",
  "pos.manage",
  "settings.manage",
  "users.manage",
  "audit.view",
  "compliance.view",
  "compliance.manage",
  "reports.view",
  "integrations.manage",
];

const MATRIX: Record<Role, Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== "users.manage" && p !== "integrations.manage"),
  INVENTORY: [
    "inventory.view",
    "inventory.write",
    "inventory.adjust",
    "catalog.manage",
    "manufacturing.write",
    "cultivation.view",
    "sales.view",
    "audit.view",
    "compliance.view",
    "reports.view",
  ],
  CULTIVATION: ["inventory.view", "cultivation.view", "cultivation.write"],
  SALES: ["inventory.view", "sales.view", "sales.write", "reports.view"],
  BUDTENDER: ["inventory.view", "pos.use"],
  READ_ONLY: ["inventory.view", "cultivation.view", "sales.view", "audit.view", "compliance.view", "reports.view"],
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
