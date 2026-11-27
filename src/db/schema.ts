import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
/** Cost per unit keeps 8 decimals so tiny unit costs survive (APEX-16). */
const cost = (name: string) => numeric(name, { precision: 18, scale: 8 });

export const roleEnum = pgEnum("role", [
  "OWNER",
  "MANAGER",
  "INVENTORY",
  "CULTIVATION",
  "SALES",
  "BUDTENDER",
  "READ_ONLY",
]);
export const licenseTypeEnum = pgEnum("license_type", [
  "CULTIVATION",
  "MANUFACTURING",
  "DISTRIBUTION",
  "RETAIL",
  "MICROBUSINESS",
]);
export const trackTraceEnum = pgEnum("track_trace_system", ["MOCK", "METRC", "BIOTRACK", "NMS2S"]);
export const locationTypeEnum = pgEnum("location_type", ["ROOM", "RACK", "BIN"]);
/** What a room is used for. Set on rooms made under Settings → Facilities. */
export const roomAreaEnum = pgEnum("room_area", [
  "PROPAGATION",
  "VEGETATIVE",
  "FLOWERING",
  "HARVEST",
  "DRYING_TRIMMING",
  "INVENTORY",
  "QUARANTINE",
  "WASTE",
]);
export const unitEnum = pgEnum("unit", ["MG", "G", "KG", "OZ", "LB", "ML", "L", "EACH"]);
export const packageStatusEnum = pgEnum("package_status", [
  "ACTIVE",
  "ON_HOLD",
  "QUARANTINE",
  "FINISHED",
  "DESTROYED",
  // Set aside for a wholesale order; nothing else may use it until it ships or is released.
  "ALLOCATED",
]);
export const transactionTypeEnum = pgEnum("transaction_type", [
  "RECEIVE",
  "MOVE",
  "ADJUST",
  "SPLIT_OUT",
  "SPLIT_IN",
  "MERGE_OUT",
  "MERGE_IN",
  "CONVERT_OUT",
  "CONVERT_IN",
  "SELL",
  "DESTROY",
  "STATUS_CHANGE",
  /** Stock coming back from a customer: a return or a voided sale. */
  "RETURN",
]);

export const limitCategoryEnum = pgEnum("limit_category", ["NONE", "FLOWER", "CONCENTRATE", "EDIBLE"]);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  /** A sample business for the public live demo. Never a real customer. */
  isDemo: boolean("is_demo").notNull().default(false),
  /** For the live demo: the UTC day it was made for (one per day), and whether its sample data finished loading. */
  demoDay: text("demo_day").unique(),
  demoReady: boolean("demo_ready").notNull().default(false),
  /** Tally questions asked in this demo day, so a public demo cannot run up the AI bill. */
  demoAssistantCalls: integer("demo_assistant_calls").notNull().default(0),
  /**
   * While Leaf2Sale is invite-only: set when Leaf2Sale support approves this business (setting it up in the
   * Support Console does this), so its owner and the staff they invite can sign in without being on the
   * server's email list.
   */
  accessApprovedAt: timestamp("access_approved_at", { withTimezone: true }),
  /** Set when support suspends the business (for example, unpaid). Nobody in it can sign in until restored. */
  accessSuspendedAt: timestamp("access_suspended_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const facilities = pgTable(
  "facilities",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    licenseNumber: text("license_number").notNull(),
    licenseType: licenseTypeEnum("license_type").notNull(),
    state: text("state").notNull(),
    trackTraceSystem: trackTraceEnum("track_trace_system").notNull().default("MOCK"),
    /** When this facility's own license expires (YYYY-MM-DD), filled in from a scanned license. Null = not tracked yet. */
    licenseExpires: text("license_expires"),
    /** False when an owner has hidden it from the facility menu and Dashboard. Nothing is deleted. */
    active: boolean("active").notNull().default(true),
    /** Waste and destruction needs the name of a second person who watched it (off unless the owner turns it on). */
    wasteWitnessRequired: boolean("waste_witness_required").notNull().default(false),
    /** Quantity changes larger than this percent of a package need a manager or owner. Null turns the check off. */
    adjustApprovalPercent: integer("adjust_approval_percent").default(25),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("facilities_org_license_key").on(t.orgId, t.licenseNumber)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("READ_ONLY"),
    /** When set, this role's permissions replace the built-in role's. */
    customRoleId: text("custom_role_id").references(() => customRoles.id),
    active: boolean("active").notNull().default(true),
    /** Sign-ins from before this moment no longer work (set when the password changes). */
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    /** Facilities this person may work at. Null means every facility; owners always have every facility. */
    facilityIds: text("facility_ids").array(),
    /** Where they were last working, so signing in returns them there. */
    lastFacilityId: text("last_facility_id"),
    /** Wants the morning brief by email each day. */
    morningBrief: boolean("morning_brief").notNull().default(false),
    /** The local date (YYYY-MM-DD) the brief was last emailed, so a retried run never sends it twice. */
    morningBriefSentOn: text("morning_brief_sent_on"),
    /** Two-step sign-in: the authenticator secret, encrypted. Set while setting up; counts only once totpEnabledAt is set. */
    totpSecret: text("totp_secret"),
    /** When two-step sign-in was switched on. Null means it is off (or setup was never finished). */
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    /** The newest 30-second step already accepted, so the same code cannot be used twice. */
    totpLastStep: integer("totp_last_step"),
    /** Hashes of the unused recovery codes (each works once). Never the codes themselves. */
    recoveryCodeHashes: text("recovery_code_hashes").array(),
    createdAt: createdAt(),
  },
  (t) => [index("users_org_idx").on(t.orgId)],
);

/**
 * One-time links for setting a new password, made by a manager for a team member (there is no email
 * sending yet). Only a hash of the link's secret is stored, so a database copy can't be used to sign in.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    createdByName: text("created_by_name").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

/**
 * Leaf2Sale staff who may open any customer's account to help them (the support console).
 * Granted only by another support admin; never from inside a customer's own settings.
 */
export const platformAdmins = pgTable("platform_admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  addedByName: text("added_by_name").notNull(),
  createdAt: createdAt(),
});

/**
 * A business's own Claude (Anthropic) connection for Tally. One per business, shared by everyone in it.
 * The API key is stored only encrypted (see lib/ai/secret-box); key_hint is the last four characters.
 */
export const aiConnections = pgTable("ai_connections", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organizations.id),
  encryptedKey: text("encrypted_key").notNull(),
  keyHint: text("key_hint").notNull(),
  model: text("model").notNull(),
  /** Models this key could use when it was last checked. */
  availableModels: jsonb("available_models").$type<{ id: string; name: string }[]>().notNull().default([]),
  /** CONNECTED, INVALID_KEY, NO_CREDIT, RATE_LIMITED, or ERROR. */
  status: text("status").notNull().default("CONNECTED"),
  statusMessage: text("status_message"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  connectedByName: text("connected_by_name").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  /** Tally can be paused without removing the key. */
  enabled: boolean("enabled").notNull().default(true),
  dailyLimit: integer("daily_limit").notNull().default(300),
  monthlyLimit: integer("monthly_limit").notNull().default(5000),
  perPersonDailyLimit: integer("per_person_daily_limit").notNull().default(60),
  maxAnswerTokens: integer("max_answer_tokens").notNull().default(2048),
});

/**
 * One row per change Tally made after a Confirm. It points at the audit entries the change wrote,
 * which is what Undo reverses. The key comes from the signed proposal, so confirming twice does nothing.
 */
export const tallyChanges = pgTable(
  "tally_changes",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    key: text("key").notNull(),
    tool: text("tool").notNull(),
    title: text("title").notNull(),
    result: text("result").notNull(),
    /** Audit entry ids written by this change, oldest first. */
    auditIds: jsonb("audit_ids").notNull().$type<string[]>(),
    /** DONE, or UNDONE once reversed. */
    status: text("status").notNull().default("DONE"),
    /** Why it can't be undone, when the change includes something Undo can't reverse. */
    notUndoableReason: text("not_undoable_reason"),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneByName: text("undone_by_name"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tally_changes_org_key").on(t.orgId, t.key), index("tally_changes_scope_idx").on(t.orgId, t.facilityId, t.createdAt)],
);

export type TallyChange = typeof tallyChanges.$inferSelect;

/**
 * Tally Watch: problems found by the regular sweep of a facility. One row per problem (key), kept
 * up to date by each sweep: reopened if it comes back, resolved when it's gone, or dismissed by a person.
 */
export const watchFindings = pgTable(
  "watch_findings",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    key: text("key").notNull(),
    check: text("check").notNull(),
    /** critical, warning, or info */
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    /** Who may see it. Null: everyone at the facility. */
    permission: text("permission"),
    href: text("href"),
    /** A Tally tool and input that fixes it, shown as a plan card the person approves. */
    fix: jsonb("fix").$type<{ tool: string; input: Record<string, unknown>; label: string } | null>(),
    /** When the fix needs a conversation (missing details), what to ask Tally. */
    ask: text("ask"),
    /** OPEN, RESOLVED, or DISMISSED */
    status: text("status").notNull().default("OPEN"),
    firstSeenAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    dismissedByName: text("dismissed_by_name"),
  },
  (t) => [uniqueIndex("watch_findings_facility_key").on(t.facilityId, t.key), index("watch_findings_open_idx").on(t.orgId, t.facilityId, t.status)],
);

export type WatchFinding = typeof watchFindings.$inferSelect;

/** When each facility was last swept, and what was found. */
export const watchSweeps = pgTable(
  "watch_sweeps",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    open: integer("open").notNull(),
    opened: integer("opened").notNull(),
    resolved: integer("resolved").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("watch_sweeps_facility_idx").on(t.facilityId, t.createdAt)],
);

/**
 * Each run of a scheduled job (state reporting, Tally Watch), so the app can show when it last ran,
 * whether it worked, and warn when it hasn't run on time. Platform-wide: no business data in it.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: id(),
    /** "sync" (state reports and webhooks) or "watch" (Tally Watch sweep). */
    job: text("job").notNull(),
    /** RUNNING, OK, or FAILED. */
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    summary: jsonb("summary").$type<Record<string, unknown> | null>(),
    error: text("error"),
  },
  (t) => [index("job_runs_job_time_idx").on(t.job, t.startedAt)],
);

export type JobRun = typeof jobRuns.$inferSelect;

/**
 * A package report exported from the state system (for example Metrc's Packages grid) and uploaded,
 * so Tally Watch can compare it with Leaf2Sale until a live connection is approved.
 */
export const stateReports = pgTable(
  "state_reports",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    fileName: text("file_name").notNull(),
    uploadedByName: text("uploaded_by_name").notNull(),
    rows: jsonb("rows").notNull().$type<{ tag: string; quantity: string | null; unit: string | null; item: string | null; status: string | null }[]>(),
    createdAt: createdAt(),
  },
  (t) => [index("state_reports_facility_idx").on(t.facilityId, t.createdAt)],
);

/**
 * Files attached to Tally chats. Private to the person who uploaded them, at one facility, and
 * deleted automatically when they expire. The stored payload is encrypted and is only what Tally
 * needs (a re-encoded image, the PDF, or extracted text/rows), never served back as a download.
 */
export const tallyAttachments = pgTable(
  "tally_attachments",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    /** IMAGE, PDF, SPREADSHEET, DOCUMENT */
    kind: text("kind").notNull(),
    /** Bytes the person uploaded. */
    size: integer("size").notNull(),
    /** UPLOADING while chunks arrive, then READY. */
    status: text("status").notNull().default("UPLOADING"),
    received: integer("received").notNull().default(0),
    /** Raw upload while it arrives; cleared once processed. */
    staging: bytea("staging"),
    /** Encrypted processed content. */
    payload: bytea("payload"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    sha256: text("sha256"),
    /** "chat" for a file attached to a Tally question, "phone" for a photo sent from a linked phone. */
    source: text("source").notNull().default("chat"),
    /** The linked phone that sent it, when source is "phone". */
    deviceId: text("device_id"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("tally_attachments_owner_idx").on(t.orgId, t.userId, t.createdAt), index("tally_attachments_expiry_idx").on(t.expiresAt)],
);

export type TallyAttachment = typeof tallyAttachments.$inferSelect;

/** One row per Tally question: who asked, which account paid, tokens used, and how it ended. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    facilityId: text("facility_id"),
    /** CUSTOMER (the business's own key) or PLATFORM (Leaf2Sale's key: live demo and allowed test accounts only). */
    billedTo: text("billed_to").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** OK, or the error kind (INVALID_KEY, NO_CREDIT, RATE_LIMITED, ERROR, ABORTED). */
    outcome: text("outcome").notNull(),
    supportVisit: boolean("support_visit").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_org_time_idx").on(t.orgId, t.createdAt), index("ai_usage_user_time_idx").on(t.orgId, t.userId, t.createdAt)],
);

/** A role a business builds itself: a name and the exact list of things it allows. */
export const customRoles = pgTable(
  "custom_roles",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_roles_org_name_key").on(t.orgId, t.name)],
);

/** A one-time link that lets someone create their own account in a business. Only a hash of the link is kept. */
export const invites = pgTable(
  "invites",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    customRoleId: text("custom_role_id").references(() => customRoles.id),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invites_org_idx").on(t.orgId)],
);

/** Running counters for generated IDs (plant tags, package tags, SKUs), one row per business and kind. */
export const idCounters = pgTable(
  "id_counters",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind").notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.kind] })],
);

export const locations = pgTable(
  "locations",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    type: locationTypeEnum("type").notNull(),
    area: roomAreaEnum("area"),
    parentId: text("parent_id"),
  },
  (t) => [uniqueIndex("locations_facility_name_key").on(t.facilityId, t.name)],
);

export const itemCategories = pgTable(
  "item_categories",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("item_categories_org_name_key").on(t.orgId, t.name)],
);

export const items = pgTable(
  "items",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => itemCategories.id),
    unit: unitEnum("unit").notNull(),
    strain: text("strain"),
    active: boolean("active").notNull().default(true),
    // How one unit of this item counts toward retail purchase limits:
    // grams for FLOWER and CONCENTRATE, milligrams of THC for EDIBLE.
    limitCategory: limitCategoryEnum("limit_category").notNull().default("NONE"),
    limitPerUnit: qty("limit_per_unit"),
    // Label details. Product labels pull these in; nothing is typed at print time.
    /** Weight of one unit in grams, for items counted "each" (a 1 g pre-roll, a 100 g gummy tin). */
    unitWeightGrams: qty("unit_weight_grams"),
    /** Edibles and other dosed products: servings in one unit, and mg per serving from the product's formulation. */
    servingsPerUnit: integer("servings_per_unit"),
    thcMgPerServing: numeric("thc_mg_per_serving", { precision: 10, scale: 3 }),
    cbdMgPerServing: numeric("cbd_mg_per_serving", { precision: 10, scale: 3 }),
    /** Intended use and directions for use (16.8.3.9(D) NMAC). */
    directions: text("directions"),
    ingredients: text("ingredients"),
    allergens: text("allergens"),
    pesticides: text("pesticides"),
    solvents: text("solvents"),
    mustRefrigerate: boolean("must_refrigerate").notNull().default(false),
    /** The store takes this item back. Reward points cannot pay for it, so a returned sale never keeps the reward value (APEX-40). Most stores do not take back opened product. */
    returnable: boolean("returnable").notNull().default(false),
    /** Days from the date packaged to the expiration date printed on labels. */
    shelfLifeDays: integer("shelf_life_days"),
  },
  (t) => [uniqueIndex("items_org_sku_key").on(t.orgId, t.sku)],
);

export const packages = pgTable(
  "packages",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    tag: text("tag").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    quantity: qty("quantity").notNull(),
    unit: unitEnum("unit").notNull(),
    locationId: text("location_id").references(() => locations.id),
    status: packageStatusEnum("status").notNull().default("ACTIVE"),
    /** When the package last went on hold or into quarantine; cleared on release. Used for waste hold periods. */
    heldSince: timestamp("held_since", { withTimezone: true }),
    lotNumber: text("lot_number"),
    /** Typed in for packages with no harvest record behind them (received from outside, or imported). A real harvest record always wins on labels. */
    harvestName: text("harvest_name"),
    /** YYYY-MM-DD. */
    harvestDate: text("harvest_date"),
    costPerUnit: cost("cost_per_unit"),
    /** The vendor this package was bought from, when it was received from outside. */
    vendorId: text("vendor_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("packages_org_tag_key").on(t.orgId, t.tag),
    index("packages_scope_status_idx").on(t.orgId, t.facilityId, t.status),
  ],
);

export const packageLineage = pgTable(
  "package_lineage",
  {
    parentId: text("parent_id")
      .notNull()
      .references(() => packages.id),
    childId: text("child_id")
      .notNull()
      .references(() => packages.id),
  },
  (t) => [primaryKey({ columns: [t.parentId, t.childId] })],
);

/** The only way a package quantity or location changes. Append-only (database trigger). */
export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    type: transactionTypeEnum("type").notNull(),
    quantityDelta: qty("quantity_delta").notNull(),
    quantityBefore: qty("quantity_before").notNull(),
    quantityAfter: qty("quantity_after").notNull(),
    unit: unitEnum("unit").notNull(),
    fromLocationId: text("from_location_id"),
    toLocationId: text("to_location_id"),
    reasonCode: text("reason_code"),
    note: text("note"),
    /** Destruction only: which camera recorded it and when, so the footage can be found and kept 120 days. */
    videoCamera: text("video_camera"),
    videoRecordedAt: timestamp("video_recorded_at", { withTimezone: true }),
    witnessName: text("witness_name"),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_transactions_scope_idx").on(t.orgId, t.facilityId, t.createdAt),
    index("inventory_transactions_package_idx").on(t.packageId),
  ],
);

/** Append-only (database trigger rejects UPDATE and DELETE). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id"),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.orgId, t.entityType, t.entityId),
    index("audit_logs_time_idx").on(t.orgId, t.createdAt),
  ],
);

export const labStatusEnum = pgEnum("lab_status", ["PENDING", "PASS", "FAIL"]);

export const labResults = pgTable(
  "lab_results",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    labName: text("lab_name").notNull(),
    sampleDate: text("sample_date"),
    status: labStatusEnum("status").notNull(),
    /** Total THC % (THCa × 0.877 + Δ9-THC). */
    thcPercent: numeric("thc_percent", { precision: 6, scale: 3 }),
    cbdPercent: numeric("cbd_percent", { precision: 6, scale: 3 }),
    // The rest of the cannabinoid profile from the certificate of analysis. All optional.
    thcaPercent: numeric("thca_percent", { precision: 6, scale: 3 }),
    d9ThcPercent: numeric("d9_thc_percent", { precision: 6, scale: 3 }),
    cbdaPercent: numeric("cbda_percent", { precision: 6, scale: 3 }),
    totalCbdPercent: numeric("total_cbd_percent", { precision: 6, scale: 3 }),
    cbgPercent: numeric("cbg_percent", { precision: 6, scale: 3 }),
    cbnPercent: numeric("cbn_percent", { precision: 6, scale: 3 }),
    totalCannabinoidsPercent: numeric("total_cannabinoids_percent", { precision: 6, scale: 3 }),
    /** Top terpenes as the lab reports them, for example "Myrcene 0.82%, Limonene 0.41%". */
    terpenes: text("terpenes"),
    notes: text("notes"),
    coaFileName: text("coa_file_name"),
    coaMimeType: text("coa_mime_type"),
    coaSize: integer("coa_size"),
    coaData: bytea("coa_data"),
    /** When one COA was recorded for a whole lot, the other packages' results point at the one that holds the file. */
    coaFromResultId: text("coa_from_result_id"),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("lab_results_package_idx").on(t.packageId)],
);

export const cycleCounts = pgTable(
  "cycle_counts",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    packagesCounted: integer("packages_counted").notNull(),
    variances: integer("variances").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("cycle_counts_scope_idx").on(t.orgId, t.facilityId, t.createdAt)],
);

export const cycleCountLines = pgTable(
  "cycle_count_lines",
  {
    countId: text("count_id")
      .notNull()
      .references(() => cycleCounts.id),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    expected: qty("expected").notNull(),
    counted: qty("counted").notNull(),
  },
  (t) => [primaryKey({ columns: [t.countId, t.packageId] })],
);

export const strainTypeEnum = pgEnum("strain_type", ["INDICA", "SATIVA", "HYBRID", "CBD"]);
export const batchSourceEnum = pgEnum("batch_source", ["CLONE", "SEED"]);
export const batchStatusEnum = pgEnum("batch_status", ["ACTIVE", "CLOSED"]);
export const plantPhaseEnum = pgEnum("plant_phase", ["VEGETATIVE", "FLOWERING"]);
export const plantStatusEnum = pgEnum("plant_status", ["ACTIVE", "HARVESTED", "DESTROYED"]);
export const harvestStatusEnum = pgEnum("harvest_status", ["DRYING", "FINISHED"]);

export const strains = pgTable(
  "strains",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    type: strainTypeEnum("type").notNull(),
    /** How long plants stay vegetative before they should flower. Tally uses it to draft the move to the flower room. */
    vegDays: integer("veg_days"),
    floweringDays: integer("flowering_days"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("strains_org_name_key").on(t.orgId, t.name)],
);

/** A group of immature plants that do not have individual tags yet. */
export const plantBatches = pgTable(
  "plant_batches",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    strainId: text("strain_id")
      .notNull()
      .references(() => strains.id),
    source: batchSourceEnum("source").notNull(),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id),
    initialCount: integer("initial_count").notNull(),
    untaggedCount: integer("untagged_count").notNull(),
    destroyedCount: integer("destroyed_count").notNull().default(0),
    status: batchStatusEnum("status").notNull().default("ACTIVE"),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("plant_batches_facility_name_key").on(t.facilityId, t.name)],
);

export const harvests = pgTable(
  "harvests",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    strainId: text("strain_id")
      .notNull()
      .references(() => strains.id),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id),
    plantCount: integer("plant_count").notNull(),
    // All harvest weights are stored in grams.
    wetWeight: qty("wet_weight").notNull(),
    dryWeight: qty("dry_weight"),
    wasteWeight: qty("waste_weight").notNull().default("0"),
    packagedWeight: qty("packaged_weight").notNull().default("0"),
    moistureLoss: qty("moisture_loss"),
    status: harvestStatusEnum("status").notNull().default("DRYING"),
    userId: text("user_id").notNull(),
    harvestedAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("harvests_facility_name_key").on(t.facilityId, t.name)],
);

export const plants = pgTable(
  "plants",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    tag: text("tag").notNull(),
    strainId: text("strain_id")
      .notNull()
      .references(() => strains.id),
    batchId: text("batch_id")
      .notNull()
      .references(() => plantBatches.id),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id),
    phase: plantPhaseEnum("phase").notNull().default("VEGETATIVE"),
    status: plantStatusEnum("status").notNull().default("ACTIVE"),
    harvestId: text("harvest_id").references(() => harvests.id),
    createdAt: createdAt(),
    phaseChangedAt: timestamp("phase_changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("plants_org_tag_key").on(t.orgId, t.tag),
    index("plants_scope_status_idx").on(t.orgId, t.facilityId, t.status),
  ],
);

export const harvestPackages = pgTable(
  "harvest_packages",
  {
    harvestId: text("harvest_id")
      .notNull()
      .references(() => harvests.id),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    weightGrams: qty("weight_grams").notNull(),
  },
  (t) => [primaryKey({ columns: [t.harvestId, t.packageId] })],
);

export const wasteLogs = pgTable(
  "waste_logs",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    sourceType: text("source_type").notNull(), // HARVEST | PLANT | BATCH
    sourceId: text("source_id").notNull(),
    weightGrams: qty("weight_grams").notNull(),
    reason: text("reason").notNull(),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("waste_logs_scope_idx").on(t.orgId, t.facilityId, t.createdAt)],
);

export const cultivationTasks = pgTable(
  "cultivation_tasks",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    title: text("title").notNull(),
    dueDate: text("due_date"),
    locationId: text("location_id").references(() => locations.id),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneByName: text("done_by_name"),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("cultivation_tasks_scope_idx").on(t.orgId, t.facilityId, t.done)],
);

export const runStatusEnum = pgEnum("run_status", ["IN_PROGRESS", "COMPLETED", "CANCELLED"]);

/** A recipe: what goes in and how much comes out of one batch. */
export const boms = pgTable(
  "boms",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    outputItemId: text("output_item_id")
      .notNull()
      .references(() => items.id),
    outputQuantity: qty("output_quantity").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("boms_org_name_key").on(t.orgId, t.name)],
);

export const bomLines = pgTable(
  "bom_lines",
  {
    bomId: text("bom_id")
      .notNull()
      .references(() => boms.id),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    quantity: qty("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bomId, t.itemId] })],
);

export const productionRuns = pgTable(
  "production_runs",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    bomId: text("bom_id")
      .notNull()
      .references(() => boms.id),
    outputItemId: text("output_item_id")
      .notNull()
      .references(() => items.id),
    batches: qty("batches").notNull(),
    plannedOutput: qty("planned_output").notNull(),
    actualOutput: qty("actual_output"),
    outputPackageId: text("output_package_id").references(() => packages.id),
    inputCost: qty("input_cost"),
    extraCost: qty("extra_cost"),
    costPerUnit: cost("cost_per_unit"),
    lossNote: text("loss_note"),
    status: runStatusEnum("status").notNull().default("IN_PROGRESS"),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("production_runs_facility_name_key").on(t.facilityId, t.name),
    index("production_runs_scope_idx").on(t.orgId, t.facilityId, t.status),
  ],
);

export const productionInputs = pgTable(
  "production_inputs",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => productionRuns.id),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    quantity: qty("quantity").notNull(),
    unit: unitEnum("unit").notNull(),
    // Cost per unit of the source package when it was consumed; null when the package had no cost.
    costPerUnit: cost("cost_per_unit"),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("production_inputs_run_idx").on(t.runId)],
);

export const orderStatusEnum = pgEnum("order_status", ["DRAFT", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"]);
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

export const priceLists = pgTable(
  "price_lists",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [uniqueIndex("price_lists_org_name_key").on(t.orgId, t.name)],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    priceListId: text("price_list_id")
      .notNull()
      .references(() => priceLists.id),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    price: qty("price").notNull(),
  },
  (t) => [primaryKey({ columns: [t.priceListId, t.itemId] })],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    licenseNumber: text("license_number").notNull(),
    licenseType: text("license_type").notNull(),
    licenseExpires: text("license_expires").notNull(), // YYYY-MM-DD
    licenseVerifiedAt: timestamp("license_verified_at", { withTimezone: true }),
    licenseVerifiedBy: text("license_verified_by"),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    priceListId: text("price_list_id").references(() => priceLists.id),
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** Vendor roles: a business can be one we sell to, one we buy from, or both. */
    weSellTo: boolean("we_sell_to").notNull().default(true),
    weBuyFrom: boolean("we_buy_from").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customers_org_license_key").on(t.orgId, t.licenseNumber)],
);

/**
 * A vendor's licensed location that product can ship to (Flourish calls these destinations).
 * A vendor can have several; orders ship to one, and its license is the one checked at shipping.
 */
export const destinations = pgTable(
  "destinations",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => customers.id),
    name: text("name").notNull(),
    licenseNumber: text("license_number").notNull(),
    licenseType: text("license_type").notNull(),
    licenseExpires: text("license_expires").notNull(), // YYYY-MM-DD
    licenseVerifiedAt: timestamp("license_verified_at", { withTimezone: true }),
    licenseVerifiedBy: text("license_verified_by"),
    address: text("address"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("destinations_vendor_license_key").on(t.vendorId, t.licenseNumber), index("destinations_org_idx").on(t.orgId)],
);

export const drivers = pgTable("drivers", {
  id: id(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  licenseNumber: text("license_number").notNull(),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
});

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    make: text("make").notNull(),
    model: text("model").notNull(),
    plate: text("plate").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("vehicles_org_plate_key").on(t.orgId, t.plate)],
);

/** Running numbers for orders, manifests, and invoices, one row per facility and kind. */
export const counters = pgTable(
  "counters",
  {
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    kind: text("kind").notNull(),
    value: integer("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.kind] })],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    number: text("number").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    /** Where it ships. Older orders, from before destinations, have none and use the vendor's own license. */
    destinationId: text("destination_id").references(() => destinations.id),
    status: orderStatusEnum("status").notNull().default("DRAFT"),
    notes: text("notes"),
    userName: text("user_name").notNull(),
    manifestNumber: text("manifest_number"),
    driverId: text("driver_id").references(() => drivers.id),
    vehicleId: text("vehicle_id").references(() => vehicles.id),
    departAt: text("depart_at"),
    routeNotes: text("route_notes"),
    receivedBy: text("received_by"),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("orders_facility_number_key").on(t.facilityId, t.number),
    index("orders_scope_idx").on(t.orgId, t.facilityId, t.status),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    quantity: qty("quantity").notNull(),
    unitPrice: qty("unit_price").notNull(),
  },
  (t) => [uniqueIndex("order_lines_order_item_key").on(t.orderId, t.itemId)],
);

export const orderAllocations = pgTable(
  "order_allocations",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    orderLineId: text("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    quantity: qty("quantity").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("order_allocations_package_key").on(t.packageId), index("order_allocations_order_idx").on(t.orderId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    number: text("number").notNull(),
    total: money("total").notNull(),
    dueDate: text("due_date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoices_facility_number_key").on(t.facilityId, t.number), uniqueIndex("invoices_order_key").on(t.orderId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: money("amount").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    paidOn: text("paid_on").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

export const saleStatusEnum = pgEnum("sale_status", ["OPEN", "COMPLETED", "CANCELLED", "VOIDED"]);
export const customerTypeEnum = pgEnum("customer_type", ["ADULT_USE", "MEDICAL"]);
export const drawerStatusEnum = pgEnum("drawer_status", ["OPEN", "CLOSED"]);
const percent = (name: string) => numeric(name, { precision: 6, scale: 3 });

/** Per-store retail rules. Rates and limits differ by state and city, so each store sets its own. */
export const retailSettings = pgTable("retail_settings", {
  facilityId: text("facility_id")
    .primaryKey()
    .references(() => facilities.id),
  orgId: text("org_id").notNull(),
  flowerLimitGrams: qty("flower_limit_grams").notNull(),
  concentrateLimitGrams: qty("concentrate_limit_grams").notNull(),
  edibleLimitMg: qty("edible_limit_mg").notNull(),
  exciseTaxPercent: percent("excise_tax_percent").notNull(),
  salesTaxPercent: percent("sales_tax_percent").notNull(),
  medicalTaxExempt: boolean("medical_tax_exempt").notNull().default(true),
  adultMinAge: integer("adult_min_age").notNull().default(21),
  medicalMinAge: integer("medical_min_age").notNull().default(18),
  /**
   * Require the ID number when an ID is typed by hand, so daily limits cover every customer. Scanned IDs
   * always carry their number, and a customer's purchases earlier today always count when it is known.
   */
  dailyLimits: boolean("daily_limits").notNull().default(false),
  /** Wording printed at the bottom of every receipt, as the store's state requires. */
  receiptWarning: text("receipt_warning"),
  /** Wording available to label templates as the "Store warning" field. */
  labelWarning: text("label_warning"),
});

export const retailPrices = pgTable(
  "retail_prices",
  {
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    price: qty("price").notNull(),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.itemId] })],
);

export const discountPresets = pgTable(
  "discount_presets",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    percent: percent("percent").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("discount_presets_org_name_key").on(t.orgId, t.name)],
);

/**
 * Automatic promotions: a percent or dollars off a category, a product or everything, on chosen weekdays,
 * hours and dates. The register applies them by itself. They only ever take money off (never free product).
 */
export const promotions = pgTable("promotions", {
  id: id(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  kind: text("kind").notNull(), // PERCENT | DOLLAR
  amount: numeric("amount", { precision: 10, scale: 3 }).notNull(),
  scope: text("scope").notNull(), // ALL | CATEGORY | ITEM
  categoryId: text("category_id").references(() => itemCategories.id, { onDelete: "cascade" }),
  itemId: text("item_id").references(() => items.id, { onDelete: "cascade" }),
  /** Buy-X-get-Y deals: how many are bought (or make a bundle) and how many are then discounted. */
  buyQty: integer("buy_qty"),
  getQty: integer("get_qty"),
  /** 0 = Sunday ... 6 = Saturday; empty means every day. */
  weekdays: integer("weekdays").array().notNull().default(sql`'{}'::integer[]`),
  startTime: text("start_time"),
  endTime: text("end_time"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  createdAt: createdAt(),
});

/**
 * The business's rewards (loyalty) program: one per business, shared by all its stores.
 * Points are earned per dollar paid (after discounts, before tax) and spent as dollars off. New Mexico
 * forbids giving cannabis away, so a reward can never cover more than maxSharePercent of a cart.
 */
export const rewardSettings = pgTable("reward_settings", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organizations.id),
  enabled: boolean("enabled").notNull().default(false),
  pointsPerDollar: integer("points_per_dollar").notNull().default(1),
  /** One reward costs this many points and takes this many dollars off. */
  redeemPoints: integer("redeem_points").notNull().default(100),
  redeemDollars: money("redeem_dollars").notNull().default("5.00"),
  signupBonus: integer("signup_bonus").notNull().default(25),
  birthdayBonus: integer("birthday_bonus").notNull().default(50),
  /** Points run out after this many months with no purchase; 0 means never. */
  expireMonths: integer("expire_months").notNull().default(12),
  /** The most of a cart (after other discounts) that rewards may pay for. */
  maxSharePercent: integer("max_share_percent").notNull().default(50),
  /** Recognize a shopper from their scanned ID at check-in (a one-way fingerprint of the ID number, never the number). */
  idLookup: boolean("id_lookup").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A shopper in the rewards program. Only what the program needs: a phone number, a first name, and an optional birthday. */
export const rewardMembers = pgTable(
  "reward_members",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    /** Digits only, 10 long (US). */
    phone: text("phone").notNull(),
    firstName: text("first_name").notNull(),
    /** Month and day only, "MM-DD", for the birthday bonus. Never the year. */
    birthday: text("birthday"),
    points: integer("points").notNull().default(0),
    /** One-way fingerprint of the shopper's ID number (same key as the daily-limit key), set only with their agreement. */
    idKey: text("id_key"),
    /** When the shopper agreed to join, and the budtender who asked. */
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    joinedBy: text("joined_by").notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reward_members_org_phone_key").on(t.orgId, t.phone),
    uniqueIndex("reward_members_org_id_key").on(t.orgId, t.idKey).where(sql`${t.idKey} is not null`),
  ],
);

/** What each promotion took off each completed sale, for the Promotions results. Kept even if the promotion is later deleted. */
export const salePromotions = pgTable(
  "sale_promotions",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    promoId: text("promo_id").notNull(),
    promoName: text("promo_name").notNull(),
    /** Cart lines the promotion discounted on this sale. */
    lineCount: integer("line_count").notNull(),
    amount: money("amount").notNull(),
  },
  (t) => [index("sale_promotions_org_promo_idx").on(t.orgId, t.promoId), index("sale_promotions_sale_idx").on(t.saleId)],
);

/** Every change to a shopper's points, so balances can always be explained. */
export const rewardLedger = pgTable(
  "reward_ledger",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => rewardMembers.id, { onDelete: "cascade" }),
    /** SIGNUP, EARN, REDEEM, BIRTHDAY, ADJUST, EXPIRE, VOID, RETURN */
    kind: text("kind").notNull(),
    points: integer("points").notNull(),
    saleId: text("sale_id"),
    note: text("note"),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("reward_ledger_member_idx").on(t.memberId, t.createdAt), index("reward_ledger_sale_idx").on(t.saleId)],
);

/** One till shift: opened with a float, closed with a count. */
export const drawerSessions = pgTable(
  "drawer_sessions",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    status: drawerStatusEnum("status").notNull().default("OPEN"),
    openingCash: money("opening_cash").notNull(),
    /** Whose drawer this is: each person counts their own. Null on drawers opened before drawers were per person. */
    userId: text("user_id").references(() => users.id),
    openedByName: text("opened_by_name").notNull(),
    openedAt: createdAt(),
    countedCash: money("counted_cash"),
    expectedCash: money("expected_cash"),
    closedByName: text("closed_by_name"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("drawer_sessions_scope_idx").on(t.orgId, t.facilityId, t.status), index("drawer_sessions_user_idx").on(t.facilityId, t.userId, t.status)],
);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    drawerSessionId: text("drawer_session_id")
      .notNull()
      .references(() => drawerSessions.id),
    number: text("number").notNull(),
    status: saleStatusEnum("status").notNull().default("OPEN"),
    customerType: customerTypeEnum("customer_type").notNull(),
    discountName: text("discount_name"),
    discountPercent: percent("discount_percent").notNull().default("0"),
    subtotal: money("subtotal"),
    discountTotal: money("discount_total"),
    exciseTax: money("excise_tax"),
    salesTax: money("sales_tax"),
    total: money("total"),
    /** CASH, DEBIT, or SPLIT (part debit, part cash). */
    paymentMethod: text("payment_method"),
    cashTendered: money("cash_tendered"),
    /** The amount charged to debit. Null on sales from before split payments existed. */
    debitAmount: money("debit_amount"),
    /** Optional, for matching a card payment to the store's own terminal: the last 4 digits and the approval number. Leaf2Sale never charges cards. */
    cardLast4: text("card_last4"),
    cardRef: text("card_ref"),
    /** A sale rung up on a register with no internet: its own id (so syncing twice never doubles it), and what a manager should check. */
    offlineId: text("offline_id"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    changeDue: money("change_due"),
    voidReason: text("void_reason"),
    /**
     * For per-customer daily limits: a keyed one-way fingerprint of the customer's ID number, the
     * same for the same ID at this business. The ID number itself is never stored.
     */
    customerKey: text("customer_key"),
    /** Rewards: the shopper on this sale, how many rewards they used (each worth the program's redeem points and dollars), the dollars that took off, and the points the sale earned. */
    rewardMemberId: text("reward_member_id").references(() => rewardMembers.id, { onDelete: "set null" }),
    rewardsUsed: integer("rewards_used").notNull().default(0),
    rewardDiscount: money("reward_discount").notNull().default("0"),
    pointsEarned: integer("points_earned").notNull().default(0),
    /** Automatic promotions: the dollars they took off this sale and their names (kept as a record, since promotions change). */
    promoDiscount: money("promo_discount").notNull().default("0"),
    promoNames: text("promo_names"),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sales_facility_number_key").on(t.facilityId, t.number),
    uniqueIndex("sales_facility_offline_key").on(t.facilityId, t.offlineId),
    index("sales_session_idx").on(t.drawerSessionId, t.status),
    index("sales_customer_day_idx").on(t.orgId, t.customerKey, t.completedAt),
    // Dashboards, reports and the daily check read sales by store and date; without these they scan every sale ever made (Apex: ~3 s at one million sales).
    index("sales_facility_completed_idx").on(t.facilityId, t.completedAt),
    index("sales_org_completed_idx").on(t.orgId, t.completedAt),
    // The manager review queue and its badge look only at the few offline sales with a note.
    index("sales_review_idx").on(t.facilityId, t.reviewedAt).where(sql`${t.reviewNote} is not null`),
  ],
);

/** Items a customer brought back from a completed sale, on any day, with the refund. */
export const saleReturns = pgTable(
  "sale_returns",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    number: text("number").notNull(),
    /** CASH (from an open drawer), CARD (refunded on the card terminal), or SPLIT (cash and card, for a sale paid both ways). */
    refundMethod: text("refund_method").notNull(),
    /** The drawer the cash came out of, for cash refunds. */
    drawerSessionId: text("drawer_session_id").references(() => drawerSessions.id),
    amount: money("amount").notNull(),
    /** How much of the refund came out of the drawer as cash (a SPLIT refund returns cash and card shares). Null on older returns: all of a CASH refund, none of a CARD one. */
    cashAmount: money("cash_amount"),
    /** RESTOCK (sealed, back on the shelf) or DISPOSE (opened or damaged, written off). */
    disposition: text("disposition").notNull(),
    reason: text("reason").notNull(),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sale_returns_facility_number_key").on(t.facilityId, t.number), index("sale_returns_sale_idx").on(t.saleId), index("sale_returns_drawer_idx").on(t.drawerSessionId)],
);

export const saleReturnLines = pgTable(
  "sale_return_lines",
  {
    returnId: text("return_id")
      .notNull()
      .references(() => saleReturns.id),
    saleLineId: text("sale_line_id")
      .notNull()
      .references(() => saleLines.id),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    quantity: qty("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.returnId, t.saleLineId, t.packageId] })],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: id(),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    quantity: qty("quantity").notNull(),
    unitPrice: qty("unit_price").notNull(),
    /**
     * How this line counted toward purchase limits when the sale was completed. Kept on the line so a
     * later edit to the item can't change what an earlier sale counted for. Empty on carts still open
     * and on sales from before this was kept (those fall back to the item's current numbers).
     */
    limitCategory: limitCategoryEnum("limit_category"),
    limitPerUnit: qty("limit_per_unit"),
    /** The automatic-promotion dollars this line carried when the sale was completed, so a partial return refunds what that line actually cost. */
    promoDiscount: money("promo_discount").notNull().default("0"),
  },
  (t) => [uniqueIndex("sale_lines_sale_item_key").on(t.saleId, t.itemId)],
);

/** Which packages a completed sale line was taken from, for traceability. */
export const saleLinePackages = pgTable(
  "sale_line_packages",
  {
    saleLineId: text("sale_line_id")
      .notNull()
      .references(() => saleLines.id),
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id),
    quantity: qty("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.saleLineId, t.packageId] })],
);

export const syncStatusEnum = pgEnum("sync_status", ["PENDING", "SENT", "FAILED", "MANUAL", "RESOLVED"]);

/**
 * Outbox of records owed to the state track-and-trace system. A row is written in the same
 * database transaction as the change it describes, so a change can never be saved without it.
 */
export const syncEvents = pgTable(
  "sync_events",
  {
    id: id(),
    // Strict sending order within a facility.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    system: trackTraceEnum("system").notNull(),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull(),
    status: syncStatusEnum("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
    lastErrorDetail: text("last_error_detail"),
    externalId: text("external_id"),
    resolvedBy: text("resolved_by"),
    resolvedNote: text("resolved_note"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("sync_events_queue_idx").on(t.facilityId, t.status, t.seq),
    index("sync_events_scope_idx").on(t.orgId, t.facilityId, t.createdAt),
  ],
);

/** Keys for the REST API. Only a hash is stored; the key itself is shown once when created. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    canWrite: boolean("can_write").notNull().default(false),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_org_idx").on(t.orgId)],
);

/** How many requests each API key made in each minute, so one key cannot flood the service (APEX-19). */
export const apiRateWindows = pgTable(
  "api_rate_windows",
  {
    keyId: text("key_id").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.windowStart] })],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    active: boolean("active").notNull().default(true),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("webhooks_facility_idx").on(t.facilityId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("PENDING"), // PENDING | DELIVERED | FAILED
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastResponse: text("last_response"),
    createdAt: createdAt(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("webhook_deliveries_queue_idx").on(t.status, t.nextAttemptAt), index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)],
);

export const packagesRelations = relations(packages, ({ one }) => ({
  item: one(items, { fields: [packages.itemId], references: [items.id] }),
  location: one(locations, { fields: [packages.locationId], references: [locations.id] }),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type SyncEvent = typeof syncEvents.$inferSelect;
export type TrackTraceSystem = (typeof trackTraceEnum.enumValues)[number];
export type Sale = typeof sales.$inferSelect;
export type RetailSettings = typeof retailSettings.$inferSelect;
export type DrawerSession = typeof drawerSessions.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type ProductionRun = typeof productionRuns.$inferSelect;
export type Harvest = typeof harvests.$inferSelect;
export type Plant = typeof plants.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type PackageStatus = (typeof packageStatusEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// SmartLabel: label templates, printers, and print jobs.
// Labels never change inventory. They only read records and log what was printed.

export const labelKindEnum = pgEnum("label_kind", ["PLANT", "BATCH", "PACKAGE", "PRODUCT", "TRANSFER"]);
export const printJobStatusEnum = pgEnum("print_job_status", ["QUEUED", "RENDERED", "PRINTED", "FAILED", "CANCELLED"]);

export const labelTemplates = pgTable(
  "label_templates",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    kind: labelKindEnum("kind").notNull(),
    /** Two-letter state whose label rules this template is checked against, or null for internal labels. */
    jurisdiction: text("jurisdiction"),
    currentVersion: integer("current_version").notNull().default(1),
    isDefault: boolean("is_default").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("label_templates_facility_name_key").on(t.facilityId, t.name),
    index("label_templates_scope_idx").on(t.orgId, t.facilityId, t.kind),
  ],
);

/** Every saved design is kept so a printed label can always be traced to the exact layout used. */
export const labelTemplateVersions = pgTable(
  "label_template_versions",
  {
    id: id(),
    templateId: text("template_id")
      .notNull()
      .references(() => labelTemplates.id),
    version: integer("version").notNull(),
    widthMm: numeric("width_mm", { precision: 7, scale: 2 }).notNull(),
    heightMm: numeric("height_mm", { precision: 7, scale: 2 }).notNull(),
    elements: jsonb("elements").notNull(),
    note: text("note"),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("label_template_versions_key").on(t.templateId, t.version)],
);

export const printerProfiles = pgTable(
  "printer_profiles",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    /** How labels reach the printer: BROWSER_PDF (print dialog) or ZPL (sent straight to a Zebra through Zebra Browser Print). */
    adapter: text("adapter").notNull().default("BROWSER_PDF"),
    /** Print resolution in dots per inch, for ZPL printers (203 or 300). */
    dpi: integer("dpi").notNull().default(203),
    offsetXMm: numeric("offset_x_mm", { precision: 6, scale: 2 }).notNull().default("0"),
    offsetYMm: numeric("offset_y_mm", { precision: 6, scale: 2 }).notNull().default("0"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("printer_profiles_facility_name_key").on(t.facilityId, t.name)],
);

export const printJobs = pgTable(
  "print_jobs",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    templateId: text("template_id")
      .notNull()
      .references(() => labelTemplates.id),
    templateVersion: integer("template_version").notNull(),
    printerProfileId: text("printer_profile_id").references(() => printerProfiles.id),
    sourceType: labelKindEnum("source_type").notNull(),
    sourceIds: jsonb("source_ids").notNull(),
    copies: integer("copies").notNull().default(1),
    labelCount: integer("label_count").notNull(),
    status: printJobStatusEnum("status").notNull().default("QUEUED"),
    /** Same key twice means the same request; the second one returns the first job instead of printing again. */
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    reprintOf: text("reprint_of"),
    warnings: jsonb("warnings"),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("print_jobs_idempotency_key").on(t.orgId, t.idempotencyKey),
    index("print_jobs_scope_idx").on(t.orgId, t.facilityId, t.createdAt),
  ],
);

/** Failed sign-in attempts, kept briefly to slow down password guessing. Keys are hashed; no passwords are stored. */
export const signInFailures = pgTable(
  "sign_in_failures",
  {
    id: id(),
    /** sha256 of "email:<address>" or "ip:<address>" */
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sign_in_failures_key_idx").on(t.key, t.createdAt)],
);

/**
 * A store's public menu page (/menu/<slug>). Off until a manager turns it on. The page shows only what the
 * register could sell right now, at shelf prices, and never exact stock counts.
 */
export const onlineMenus = pgTable(
  "online_menus",
  {
    facilityId: text("facility_id")
      .primaryKey()
      .references(() => facilities.id),
    orgId: text("org_id").notNull(),
    slug: text("slug").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** Let visitors reserve items for pickup. Off means a look-only menu. */
    takeReservations: boolean("take_reservations").notNull().default(true),
    welcome: text("welcome"),
    pickupNote: text("pickup_note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("online_menus_slug_key").on(t.slug)],
);

/** Pickup reservations made on a store's public menu. Nothing is taken out of stock until the sale is rung up. */
export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    number: text("number").notNull(),
    /** NEW (waiting), READY (bagged), IN_SALE (opened at the register), CANCELLED. */
    status: text("status").notNull().default("NEW"),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    note: text("note"),
    saleId: text("sale_id"),
    handledBy: text("handled_by"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reservations_facility_number_key").on(t.facilityId, t.number), index("reservations_queue_idx").on(t.facilityId, t.status, t.createdAt)],
);

export const reservationLines = pgTable(
  "reservation_lines",
  {
    reservationId: text("reservation_id")
      .notNull()
      .references(() => reservations.id),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    quantity: qty("quantity").notNull(),
    /** The shelf price the visitor saw. The register still charges today's price. */
    unitPrice: qty("unit_price").notNull(),
  },
  (t) => [primaryKey({ columns: [t.reservationId, t.itemId] })],
);

/** A phone an employee linked to their account by scanning a QR code. It can sign itself in until revoked. */
export const linkedDevices = pgTable(
  "linked_devices",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    /** "iPhone", "Android phone", ... worked out from the browser when it was linked. */
    name: text("name").notNull(),
    /** SHA-256 of the long random token kept in the phone's cookie. The token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("linked_devices_token_key").on(t.tokenHash), index("linked_devices_user_idx").on(t.orgId, t.userId)],
);

/** A one-time, short-lived code shown as a QR code. Scanning it on a phone links that phone. */
export const devicePairings = pgTable(
  "device_pairings",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("device_pairings_code_key").on(t.codeHash)],
);

/** What Claude read from a photo or scan, waiting for a person to look it over and confirm. One per file. */
export const scanReads = pgTable(
  "scan_reads",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    facilityId: text("facility_id").notNull(),
    userId: text("user_id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    /** COA for a lab certificate, OTHER for a document we can't fill in yet. */
    kind: text("kind").notNull(),
    /** READ (waiting for review), APPLIED (saved), DISMISSED. */
    status: text("status").notNull().default("READ"),
    proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull(),
    /** What the confirmed save created, for example the lab result's id. */
    resultRef: text("result_ref"),
    createdAt: createdAt(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("scan_reads_attachment_key").on(t.attachmentId), index("scan_reads_owner_idx").on(t.orgId, t.userId, t.createdAt)],
);
export type ScanRead = typeof scanReads.$inferSelect;

/**
 * A business's QuickBooks Online connection. Both tokens are stored only encrypted (lib/ai/secret-box).
 * Intuit rotates the refresh token on every refresh, so the newest one is saved each time.
 */
export const quickbooksConnections = pgTable("quickbooks_connections", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organizations.id),
  realmId: text("realm_id").notNull(),
  companyName: text("company_name"),
  encryptedAccess: text("encrypted_access").notNull(),
  encryptedRefresh: text("encrypted_refresh").notNull(),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
  /** CONNECTED, or NEEDS_RECONNECT when Intuit no longer accepts the refresh token. */
  status: text("status").notNull().default("CONNECTED"),
  statusMessage: text("status_message"),
  connectedByName: text("connected_by_name").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncSummary: text("last_sync_summary"),
});

/** Which QuickBooks record each Leaf2Sale record became, so nothing is sent twice. */
export const quickbooksLinks = pgTable(
  "quickbooks_links",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    /** customer, invoice, or payment */
    kind: text("kind").notNull(),
    localId: text("local_id").notNull(),
    qbId: text("qb_id").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quickbooks_links_key").on(t.orgId, t.kind, t.localId)],
);

/** Production equipment at a facility: extractors, presses, dryers, scales. */
export const equipment = pgTable(
  "equipment",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    serialNumber: text("serial_number"),
    locationId: text("location_id").references(() => locations.id),
    /** ACTIVE, DOWN (out of service), or RETIRED. */
    status: text("status").notNull().default("ACTIVE"),
    maintenanceEveryDays: integer("maintenance_every_days"),
    calibrationEveryDays: integer("calibration_every_days"),
    lastMaintainedOn: text("last_maintained_on"),
    lastCalibratedOn: text("last_calibrated_on"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("equipment_facility_name_key").on(t.facilityId, t.name), index("equipment_scope_idx").on(t.orgId, t.facilityId, t.status)],
);

/** Maintenance, calibration, repairs and notes for a piece of equipment, newest first when read. */
export const equipmentLogs = pgTable(
  "equipment_logs",
  {
    id: id(),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id),
    /** MAINTENANCE, CALIBRATION, REPAIR, or NOTE. */
    kind: text("kind").notNull(),
    doneOn: text("done_on").notNull(),
    note: text("note"),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("equipment_logs_equipment_idx").on(t.equipmentId, t.doneOn)],
);

/** Which equipment a production run used. */
export const productionRunEquipment = pgTable(
  "production_run_equipment",
  {
    runId: text("run_id")
      .notNull()
      .references(() => productionRuns.id),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.equipmentId] })],
);

/** Itemized costs of a production run beyond its inputs: labor, packaging and supplies, overhead. */
export const productionCosts = pgTable(
  "production_costs",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => productionRuns.id),
    kind: text("kind").notNull(), // LABOR | PACKAGING | OVERHEAD | OTHER
    description: text("description").notNull(),
    amount: qty("amount").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("production_costs_run_idx").on(t.runId)],
);

/** Automation: how much each kind of work may do on its own, an org-wide pause, and a log of what it did. */
export const automationSettings = pgTable(
  "automation_settings",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind").notNull(),
    mode: text("mode").notNull().default("OFF"), // OFF | ASK | AUTO
    hourlyCap: integer("hourly_cap").notNull().default(50),
    updatedByName: text("updated_by_name"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.kind] })],
);

export const automationControl = pgTable("automation_control", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organizations.id),
  paused: boolean("paused").notNull().default(false),
  pausedByName: text("paused_by_name"),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  reason: text("reason"),
});

export const automationActivity = pgTable(
  "automation_activity",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: text("facility_id").references(() => facilities.id),
    kind: text("kind").notNull(),
    outcome: text("outcome").notNull(), // DONE | PROPOSED | BLOCKED | FAILED
    summary: text("summary").notNull(),
    trigger: text("trigger"),
    requestedBy: text("requested_by"),
    createdAt: createdAt(),
  },
  (t) => [index("automation_activity_org_idx").on(t.orgId, t.createdAt), index("automation_activity_kind_idx").on(t.orgId, t.kind, t.outcome, t.createdAt)],
);
