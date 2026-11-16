import { relations } from "drizzle-orm";
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
]);

export const limitCategoryEnum = pgEnum("limit_category", ["NONE", "FLOWER", "CONCENTRATE", "EDIBLE"]);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
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
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("users_org_idx").on(t.orgId)],
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
    lotNumber: text("lot_number"),
    costPerUnit: qty("cost_per_unit"),
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
    thcPercent: numeric("thc_percent", { precision: 6, scale: 3 }),
    cbdPercent: numeric("cbd_percent", { precision: 6, scale: 3 }),
    notes: text("notes"),
    coaFileName: text("coa_file_name"),
    coaMimeType: text("coa_mime_type"),
    coaSize: integer("coa_size"),
    coaData: bytea("coa_data"),
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
    costPerUnit: qty("cost_per_unit"),
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
    costPerUnit: qty("cost_per_unit"),
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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customers_org_license_key").on(t.orgId, t.licenseNumber)],
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
    openedByName: text("opened_by_name").notNull(),
    openedAt: createdAt(),
    countedCash: money("counted_cash"),
    expectedCash: money("expected_cash"),
    closedByName: text("closed_by_name"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("drawer_sessions_scope_idx").on(t.orgId, t.facilityId, t.status)],
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
    paymentMethod: text("payment_method"),
    cashTendered: money("cash_tendered"),
    changeDue: money("change_due"),
    voidReason: text("void_reason"),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sales_facility_number_key").on(t.facilityId, t.number), index("sales_session_idx").on(t.drawerSessionId, t.status)],
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
