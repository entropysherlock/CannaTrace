/**
 * Every kind of document Tally can recognise besides a lab certificate: what to look for on it, which columns its
 * lines have, and what happens to it next. Shared by the server (to teach the reader) and the review screen.
 * Nothing here may import server-only code.
 */

export type DocField = { key: string; label: string; kind?: "date" | "money" | "number" };

export type DocDef = {
  type: string;
  label: string;
  /** One line telling the reader what this document looks like. */
  looks: string;
  fields: DocField[];
  itemsLabel?: string;
  itemColumns?: DocField[];
  /** Plain words on what the person can do with it today. */
  next: string;
};

const f = (key: string, label: string, kind?: DocField["kind"]): DocField => ({ key, label, kind });

const LINES = [f("description", "Item"), f("sku", "SKU"), f("quantity", "Qty", "number"), f("unitPrice", "Unit price", "money"), f("lineTotal", "Line total", "money")];

export const DOCS: DocDef[] = [
  {
    type: "MANIFEST",
    label: "Transport manifest",
    looks: "A state transport manifest or delivery manifest listing cannabis packages moving between two licensed businesses.",
    fields: [f("manifestNumber", "Manifest number"), f("shipDate", "Ship date", "date"), f("sender", "Sender"), f("senderLicense", "Sender license"), f("receiver", "Receiver"), f("receiverLicense", "Receiver license"), f("driver", "Driver"), f("vehicle", "Vehicle")],
    itemsLabel: "Packages",
    itemColumns: [f("packageTag", "Package tag"), f("product", "Product"), f("quantity", "Qty", "number"), f("unit", "Unit"), f("lotNumber", "Lot")],
    next: "Kept in your inbox. Receiving straight from a manifest is the next thing being added.",
  },
  {
    type: "INVOICE",
    label: "Invoice or packing slip",
    looks: "A supplier invoice, bill or packing slip with line items and amounts.",
    fields: [f("invoiceNumber", "Invoice number"), f("invoiceDate", "Invoice date", "date"), f("dueDate", "Due date", "date"), f("vendor", "Vendor"), f("billTo", "Bill to"), f("subtotal", "Subtotal", "money"), f("tax", "Tax", "money"), f("total", "Total", "money")],
    itemsLabel: "Line items",
    itemColumns: LINES,
    next: "Kept in your inbox. Matching it to what you received is being added next.",
  },
  {
    type: "PURCHASE_ORDER",
    label: "Purchase order",
    looks: "A purchase order the business sent to a supplier.",
    fields: [f("poNumber", "PO number"), f("orderDate", "Order date", "date"), f("vendor", "Vendor"), f("shipTo", "Ship to"), f("expectedDate", "Expected", "date"), f("total", "Total", "money")],
    itemsLabel: "Line items",
    itemColumns: LINES,
    next: "Kept in your inbox so you can compare it to what arrives.",
  },
  {
    type: "PRICE_LIST",
    label: "Vendor price list or catalog",
    looks: "A vendor's price list, menu or product catalog with SKUs and prices.",
    fields: [f("vendor", "Vendor"), f("effectiveDate", "Effective date", "date")],
    itemsLabel: "Products",
    itemColumns: [f("sku", "SKU"), f("product", "Product"), f("category", "Category"), f("unit", "Unit"), f("price", "Price", "money")],
    next: "Kept in your inbox. Adding these as items in one step is coming.",
  },
  {
    type: "LAB_TEST_REPORT",
    label: "Lab test report (pesticides, metals, microbial)",
    looks: "A laboratory report for contaminant testing such as pesticides, heavy metals, microbials, mycotoxins or residual solvents, that is not the potency certificate.",
    fields: [f("labName", "Lab"), f("sampleDate", "Sample date", "date"), f("reportDate", "Report date", "date"), f("product", "Product"), f("batch", "Batch or lot"), f("testType", "Test type"), f("overallResult", "Overall result")],
    itemsLabel: "Results",
    itemColumns: [f("analyte", "Test"), f("result", "Result"), f("limit", "Limit"), f("status", "Status")],
    next: "Kept in your inbox with the batch it belongs to.",
  },
  {
    type: "LAB_SAMPLE_FORM",
    label: "Lab sample or chain-of-custody form",
    looks: "A form showing which sample was sent to a lab, by whom, and when.",
    fields: [f("labName", "Lab"), f("sampleDate", "Sample date", "date"), f("product", "Product"), f("batch", "Batch or lot"), f("sampleId", "Sample ID"), f("collectedBy", "Collected by"), f("receivedBy", "Received by")],
    next: "Kept in your inbox as the record of what was sent.",
  },
  {
    type: "WASTE_RECORD",
    label: "Waste or destruction record",
    looks: "A record of cannabis waste or destruction: what, how much, how and why.",
    fields: [f("wasteDate", "Date", "date"), f("method", "Method"), f("reason", "Reason"), f("witness", "Witness"), f("batch", "Batch")],
    itemsLabel: "What was destroyed",
    itemColumns: [f("reference", "Package or plant"), f("weight", "Weight", "number"), f("unit", "Unit")],
    next: "Kept in your inbox. Remember the destruction video has to be kept for 120 days.",
  },
  {
    type: "STATE_NOTICE",
    label: "Notice or inspection report from the state",
    looks: "A letter, notice, violation or inspection report from a state agency.",
    fields: [f("agency", "Agency"), f("noticeDate", "Notice date", "date"), f("referenceNumber", "Reference"), f("subject", "About"), f("deadline", "Respond by", "date"), f("requiredAction", "What it asks for")],
    next: "Kept in your inbox. Check the deadline.",
  },
  {
    type: "LICENSE",
    label: "License, permit or agent card",
    looks: "A business license, permit, certificate or employee agent card.",
    fields: [f("holder", "Holder"), f("licenseType", "Type"), f("licenseNumber", "Number"), f("issueDate", "Issued", "date"), f("expiryDate", "Expires", "date"), f("issuer", "Issued by")],
    next: "Kept in your inbox. Tracking expiry dates automatically is coming.",
  },
  {
    type: "HARVEST_SHEET",
    label: "Harvest sheet",
    looks: "A harvest or weigh sheet listing plants and their weights.",
    fields: [f("harvestName", "Harvest name"), f("strain", "Strain"), f("harvestDate", "Harvest date", "date"), f("room", "Room"), f("totalWetWeight", "Total wet weight", "number")],
    itemsLabel: "Plants",
    itemColumns: [f("plantTag", "Plant tag"), f("wetWeight", "Wet weight", "number"), f("unit", "Unit")],
    next: "Kept in your inbox. Creating a harvest from the sheet is coming.",
  },
  {
    type: "PLANT_LOG",
    label: "Plant tag or batch log",
    looks: "A log of plants or a plant batch: tags, phase changes or room moves.",
    fields: [f("batch", "Batch"), f("strain", "Strain"), f("date", "Date", "date"), f("room", "Room"), f("action", "Action")],
    itemsLabel: "Plants",
    itemColumns: [f("plantTag", "Plant tag"), f("fromRoom", "From"), f("toRoom", "To"), f("phase", "Phase")],
    next: "Kept in your inbox.",
  },
  {
    type: "PRODUCTION_RECORD",
    label: "Production or extraction batch record",
    looks: "A manufacturing or extraction batch record with inputs, outputs and yield.",
    fields: [f("batchNumber", "Batch number"), f("productionDate", "Date", "date"), f("product", "Product"), f("method", "Method"), f("inputWeight", "Input weight", "number"), f("outputWeight", "Output weight", "number"), f("yieldPercent", "Yield %", "number")],
    itemsLabel: "Inputs",
    itemColumns: [f("material", "Material"), f("weight", "Weight", "number"), f("unit", "Unit")],
    next: "Kept in your inbox.",
  },
  {
    type: "RECIPE",
    label: "Recipe or formulation sheet",
    looks: "A recipe or formulation with ingredients and amounts.",
    fields: [f("recipeName", "Recipe"), f("product", "Product"), f("batchSize", "Batch size"), f("yieldQty", "Yield")],
    itemsLabel: "Ingredients",
    itemColumns: [f("ingredient", "Ingredient"), f("amount", "Amount", "number"), f("unit", "Unit")],
    next: "Kept in your inbox.",
  },
  {
    type: "WHOLESALE_ORDER",
    label: "Wholesale order",
    looks: "An order from a wholesale customer listing items and quantities.",
    fields: [f("orderNumber", "Order number"), f("orderDate", "Order date", "date"), f("customer", "Customer"), f("customerLicense", "Customer license"), f("deliveryDate", "Deliver by", "date"), f("total", "Total", "money")],
    itemsLabel: "Line items",
    itemColumns: LINES,
    next: "Kept in your inbox. Turning it into an order is being added.",
  },
  {
    type: "RECEIPT",
    label: "Receipt or expense",
    looks: "A store receipt or expense receipt.",
    fields: [f("vendor", "Vendor"), f("date", "Date", "date"), f("total", "Total", "money"), f("tax", "Tax", "money"), f("paymentMethod", "Paid with"), f("category", "Looks like")],
    next: "Kept in your inbox.",
  },
  {
    type: "BANK_STATEMENT",
    label: "Bank or payment statement",
    looks: "A bank or payment processor statement.",
    fields: [f("institution", "Institution"), f("period", "Period"), f("openingBalance", "Opening balance", "money"), f("closingBalance", "Closing balance", "money")],
    itemsLabel: "Transactions",
    itemColumns: [f("date", "Date", "date"), f("description", "Description"), f("amount", "Amount", "money")],
    next: "Kept in your inbox.",
  },
  {
    type: "TAX_FORM",
    label: "Tax form or filing",
    looks: "A tax form, excise filing or tax notice.",
    fields: [f("formName", "Form"), f("period", "Period"), f("dueDate", "Due date", "date"), f("amountDue", "Amount due", "money"), f("filer", "Filer")],
    next: "Kept in your inbox. Check the due date.",
  },
];

export const DOC_BY_TYPE = new Map(DOCS.map((d) => [d.type, d]));

/** Customer IDs and patient cards are recognised so they are kept out of the way, but never read. */
export const SENSITIVE_ID = "SENSITIVE_ID";
export const SENSITIVE_NOTE = "This looks like a customer ID or a patient card. Tally doesn't read or store personal ID details.";

export const DOC_TYPES = ["COA", ...DOCS.map((d) => d.type), SENSITIVE_ID, "OTHER"] as const;
