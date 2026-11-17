import { and, eq } from "drizzle-orm";
import { customers, destinations, itemCategories, items, locations, locationTypeEnum, unitEnum } from "@/db/schema";
import { readTable } from "./csv";
import { db } from "./db";
import { parseDate } from "./distribution-math";
import { InventoryError, audit, createPackageInTx, type Actor } from "./inventory";
import { normalizeTag, parsePositiveQty } from "./inventory-math";

export const IMPORT_KINDS = {
  items: { label: "Items", required: ["name", "sku", "category", "unit"], optional: ["strain"] },
  locations: { label: "Locations", required: ["name", "type"], optional: [] },
  customers: {
    label: "Customers",
    required: ["name", "licenseNumber", "licenseType", "licenseExpires"],
    optional: ["paymentTermsDays", "contactName", "email", "phone", "address"],
  },
  packages: { label: "Opening inventory", required: ["tag", "sku", "quantity", "location"], optional: ["lotNumber", "costPerUnit"] },
} as const;
export type ImportKind = keyof typeof IMPORT_KINDS;

/** Header rows only, so nothing invented ends up in a real business's data. */
export const TEMPLATES: Record<ImportKind, string> = {
  items: "name,sku,category,unit,strain\n",
  locations: "name,type\n",
  customers: "name,licenseNumber,licenseType,licenseExpires,paymentTermsDays,contactName,email,phone,address\n",
  packages: "tag,sku,quantity,location,lotNumber,costPerUnit\n",
};

class RowError extends Error {}

/**
 * Import a CSV file. Every row is checked first; if any row has a problem, nothing is saved
 * and every problem is listed with its line number. Otherwise all rows are saved together.
 */
export async function importCsv(actor: Actor, kind: ImportKind, text: string): Promise<{ count: number }> {
  const spec = IMPORT_KINDS[kind];
  if (!spec) throw new InventoryError("Choose what to import.");
  const rows = readTable(text, [...spec.required], [...spec.optional]);
  if (rows.length === 0) throw new InventoryError("The file has a header row but no data.");

  const problems: string[] = [];
  const count = await db
    .transaction(async (tx) => {
      const need = (row: { line: number; values: Record<string, string> }, name: string) => {
        const value = row.values[name];
        if (!value) throw new RowError(`${name} is empty`);
        return value;
      };
      const each = async (fn: (row: (typeof rows)[number]) => Promise<void>) => {
        for (const row of rows) {
          try {
            await fn(row);
          } catch (error) {
            if (error instanceof RowError || error instanceof InventoryError) problems.push(`Line ${row.line}: ${error.message.replace(/\.$/, "")}.`);
            else throw error;
          }
          if (problems.length >= 25) break;
        }
      };

      if (kind === "items") {
        const categoryIds = new Map<string, string>();
        await each(async (row) => {
          const unit = need(row, "unit").toUpperCase();
          if (!(unitEnum.enumValues as readonly string[]).includes(unit)) throw new RowError(`unit must be one of ${unitEnum.enumValues.join(", ")}`);
          const categoryName = need(row, "category");
          let categoryId = categoryIds.get(categoryName.toLowerCase());
          if (!categoryId) {
            await tx.insert(itemCategories).values({ orgId: actor.orgId, name: categoryName }).onConflictDoNothing();
            const [cat] = await tx
              .select({ id: itemCategories.id })
              .from(itemCategories)
              .where(and(eq(itemCategories.orgId, actor.orgId), eq(itemCategories.name, categoryName)));
            categoryId = cat.id;
            categoryIds.set(categoryName.toLowerCase(), categoryId);
          }
          const sku = need(row, "sku").toUpperCase();
          const [item] = await tx
            .insert(items)
            .values({ orgId: actor.orgId, name: need(row, "name"), sku, categoryId, unit: unit as "G", strain: row.values.strain || null })
            .onConflictDoNothing({ target: [items.orgId, items.sku] })
            .returning({ id: items.id });
          if (!item) throw new RowError(`SKU ${sku} already exists`);
        });
      } else if (kind === "locations") {
        await each(async (row) => {
          const type = need(row, "type").toUpperCase();
          if (!(locationTypeEnum.enumValues as readonly string[]).includes(type)) throw new RowError("type must be ROOM, RACK, or BIN");
          const name = need(row, "name");
          const [loc] = await tx
            .insert(locations)
            .values({ orgId: actor.orgId, facilityId: actor.facilityId, name, type: type as "ROOM" })
            .onConflictDoNothing({ target: [locations.facilityId, locations.name] })
            .returning({ id: locations.id });
          if (!loc) throw new RowError(`a location called ${name} already exists here`);
        });
      } else if (kind === "customers") {
        await each(async (row) => {
          const terms = row.values.paymentTermsDays ? Number(row.values.paymentTermsDays) : 0;
          if (!Number.isInteger(terms) || terms < 0 || terms > 120) throw new RowError("paymentTermsDays must be a whole number from 0 to 120");
          const licenseNumber = need(row, "licenseNumber").toUpperCase();
          const [customer] = await tx
            .insert(customers)
            .values({
              orgId: actor.orgId,
              name: need(row, "name"),
              licenseNumber,
              licenseType: need(row, "licenseType"),
              licenseExpires: parseDate(need(row, "licenseExpires"), "licenseExpires"),
              paymentTermsDays: terms,
              contactName: row.values.contactName || null,
              email: row.values.email || null,
              phone: row.values.phone || null,
              address: row.values.address || null,
            })
            .onConflictDoNothing({ target: [customers.orgId, customers.licenseNumber] })
            .returning({ id: customers.id });
          if (!customer) throw new RowError(`a vendor with license ${licenseNumber} already exists`);
          // Their own licensed location is their first destination.
          await tx.insert(destinations).values({
            orgId: actor.orgId,
            vendorId: customer.id,
            name: need(row, "name"),
            licenseNumber,
            licenseType: need(row, "licenseType"),
            licenseExpires: parseDate(need(row, "licenseExpires"), "licenseExpires"),
            contactName: row.values.contactName || null,
            email: row.values.email || null,
            phone: row.values.phone || null,
            address: row.values.address || null,
          });
        });
      } else if (kind === "packages") {
        const skuIds = new Map((await tx.select({ id: items.id, sku: items.sku }).from(items).where(eq(items.orgId, actor.orgId))).map((i) => [i.sku, i.id]));
        const locationIds = new Map(
          (await tx.select({ id: locations.id, name: locations.name }).from(locations).where(and(eq(locations.orgId, actor.orgId), eq(locations.facilityId, actor.facilityId)))).map(
            (l) => [l.name.toLowerCase(), l.id],
          ),
        );
        await each(async (row) => {
          normalizeTag(need(row, "tag"));
          parsePositiveQty(need(row, "quantity"));
          const itemId = skuIds.get(need(row, "sku").toUpperCase());
          if (!itemId) throw new RowError(`no item with SKU ${row.values.sku}; import items first`);
          const locationId = locationIds.get(need(row, "location").toLowerCase());
          if (!locationId) throw new RowError(`no location called ${row.values.location} at this facility`);
          // A failed insert inside a savepoint keeps the outer transaction usable for checking later rows.
          await tx.transaction((sp) =>
            createPackageInTx(sp, actor, {
              tag: row.values.tag,
              itemId,
              quantity: row.values.quantity,
              locationId,
              lotNumber: row.values.lotNumber || null,
              costPerUnit: row.values.costPerUnit || null,
              note: "Imported opening inventory",
              type: "RECEIVE",
              auditAction: "RECEIVE",
            }),
          );
        });
      }

      if (problems.length) throw new RowError("rollback");
      await audit(tx, actor, { entityType: "Import", entityId: kind, action: "IMPORT", after: { kind, rows: rows.length } });
      return rows.length;
    })
    .catch((error) => {
      if (error instanceof RowError && problems.length) {
        throw new InventoryError(
          `Nothing was imported. Fix ${problems.length === 1 ? "this problem" : "these problems"} and upload the file again:\n${problems.join("\n")}`,
        );
      }
      throw error;
    });
  return { count };
}
