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
  | "integrations.manage"
  | "labels.print"
  | "labels.manage"
  | "ai.manage";

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
  "labels.print",
  "labels.manage",
  "ai.manage",
];

const MATRIX: Record<Role, Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== "users.manage" && p !== "integrations.manage" && p !== "ai.manage"),
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
    "labels.print",
    "labels.manage",
  ],
  CULTIVATION: ["inventory.view", "cultivation.view", "cultivation.write", "labels.print"],
  SALES: ["inventory.view", "sales.view", "sales.write", "reports.view", "labels.print"],
  BUDTENDER: ["inventory.view", "pos.use", "labels.print"],
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

export const ALL_PERMISSIONS: readonly Permission[] = ALL;

/** What each permission means, grouped the way the role builder shows them. */
export const PERMISSION_GROUPS: { title: string; permissions: { key: Permission; label: string; hint: string }[] }[] = [
  {
    title: "Inventory",
    permissions: [
      { key: "inventory.view", label: "See inventory", hint: "Packages, locations, history, and labels." },
      { key: "inventory.write", label: "Receive, move, split, and merge", hint: "Day-to-day package handling and counts." },
      { key: "inventory.adjust", label: "Adjust, hold, and destroy", hint: "Change quantities with a reason, quarantine, and destroy." },
      { key: "catalog.manage", label: "Manage items and locations", hint: "Add products, categories, and rooms." },
    ],
  },
  {
    title: "Cultivation and manufacturing",
    permissions: [
      { key: "cultivation.view", label: "See plants and harvests", hint: "Batches, plants, harvests, and tasks." },
      { key: "cultivation.write", label: "Work with plants", hint: "Plant, tag, move, harvest, and record waste." },
      { key: "manufacturing.write", label: "Run production", hint: "Recipes and production runs." },
    ],
  },
  {
    title: "Wholesale",
    permissions: [
      { key: "sales.view", label: "See customers and orders", hint: "Customers, orders, invoices, and payments." },
      { key: "sales.write", label: "Create and ship orders", hint: "Quote, pick, ship, invoice, and take payments." },
    ],
  },
  {
    title: "Retail",
    permissions: [
      { key: "pos.use", label: "Use the register", hint: "Check customers in and ring up sales." },
      { key: "pos.manage", label: "Run the store", hint: "Prices, discounts, limits, taxes, drawers, voids, and returns." },
    ],
  },
  {
    title: "Labels",
    permissions: [
      { key: "labels.print", label: "Print labels", hint: "Preview, print, and reprint labels from approved templates." },
      { key: "labels.manage", label: "Design labels and set up printers", hint: "Create and publish templates, set facility defaults, and configure printers." },
    ],
  },
  {
    title: "Compliance and reports",
    permissions: [
      { key: "compliance.view", label: "See state reporting", hint: "What has been sent to the state." },
      { key: "compliance.manage", label: "Manage state reporting", hint: "Retry, mark entered, and change the state system." },
      { key: "audit.view", label: "See the audit trail", hint: "Every change, who made it, and why." },
      { key: "reports.view", label: "See reports and exports", hint: "Reports and CSV downloads." },
    ],
  },
  {
    title: "Administration",
    permissions: [
      { key: "settings.manage", label: "Business settings", hint: "Facilities and imports." },
      { key: "users.manage", label: "Manage the team", hint: "Invite people, change roles, and build roles. Only an owner can hand this out." },
      { key: "integrations.manage", label: "API keys and webhooks", hint: "Connect other software. Only an owner can hand this out." },
      { key: "ai.manage", label: "Tally AI connection", hint: "Connect the business's Claude account, choose the model, and set usage limits. Only an owner can hand this out." },
    ],
  },
];

/** Permissions only an owner may give someone, because they control who can do what. */
export const OWNER_ONLY: readonly Permission[] = ["users.manage", "integrations.manage", "ai.manage"];

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/** Keep only real permission names, in a fixed order. */
export function cleanPermissions(values: readonly string[]): Permission[] {
  return ALL.filter((p) => values.includes(p));
}

/** Whether a built-in role, or a signed-in person with their resolved permissions, may do something. */
export function can(subject: Role | { permissions: readonly Permission[] }, permission: Permission): boolean {
  if (typeof subject === "string") return MATRIX[subject].includes(permission);
  return subject.permissions.includes(permission);
}
