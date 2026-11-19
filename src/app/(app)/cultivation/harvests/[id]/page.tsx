import { TriangleAlert } from "lucide-react";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect } from "@/components/contextual-create";
import { ItemFields } from "@/components/item-fields";
import { LocationFields } from "@/components/quick-fields";
import { CultivationTabs, WeightInput, grams } from "@/components/cultivation-ui";
import { ScanInput } from "@/components/scan-input";
import { Card, Field, PageHeader, inputClass, ScrollBox } from "@/components/ui";
import { harvestPackages, harvests, items, locations, packages, strains, wasteLogs } from "@/db/schema";
import { db } from "@/lib/db";
import { harvestOnHand } from "@/lib/cultivation-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel, type UnitCode } from "@/lib/units";
import { quickItemAction, quickLocationAction } from "../../../quick-create-actions";
import { dryWeightAction, finishHarvestAction, packageHarvestAction, reopenHarvestAction, wasteAction } from "../../actions";
import { itemCategoryNames } from "@/lib/quick-create-data";
import { facilityZone } from "@/lib/time";

const WEIGHT_UNITS: UnitCode[] = ["G", "KG", "OZ", "LB", "MG"];

export default async function HarvestPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("cultivation.view");
  const zone = await facilityZone(session.facilityId);
  const { id } = await params;
  const [row] = await db
    .select({ harvest: harvests, strainName: strains.name, roomName: locations.name })
    .from(harvests)
    .innerJoin(strains, eq(strains.id, harvests.strainId))
    .innerJoin(locations, eq(locations.id, harvests.locationId))
    .where(and(eq(harvests.id, id), eq(harvests.orgId, session.orgId), eq(harvests.facilityId, session.facilityId)));
  if (!row) notFound();
  const { harvest } = row;

  const [made, waste, weightItems, rooms] = await Promise.all([
    db
      .select({ id: packages.id, tag: packages.tag, itemName: items.name, weightGrams: harvestPackages.weightGrams })
      .from(harvestPackages)
      .innerJoin(packages, eq(packages.id, harvestPackages.packageId))
      .innerJoin(items, eq(items.id, packages.itemId))
      .where(eq(harvestPackages.harvestId, harvest.id))
      .orderBy(asc(packages.tag)),
    db
      .select()
      .from(wasteLogs)
      .where(and(eq(wasteLogs.sourceType, "HARVEST"), eq(wasteLogs.sourceId, harvest.id)))
      .orderBy(desc(wasteLogs.createdAt)),
    db
      .select({ id: items.id, name: items.name, unit: items.unit })
      .from(items)
      .where(and(eq(items.orgId, session.orgId), eq(items.active, true), inArray(items.unit, ["MG", "G", "KG", "OZ", "LB"])))
      .orderBy(asc(items.name)),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)))
      .orderBy(asc(locations.name)),
  ]);
  const onHand = harvestOnHand(harvest);
  const open = harvest.status === "DRYING";
  const canWrite = open && can(session, "cultivation.write");
  const canAddItem = can(session, "catalog.manage");
  const canAddLocation = can(session, "catalog.manage");
  const categories = canAddItem ? await itemCategoryNames(session.orgId) : [];
  const hidden = <input type="hidden" name="harvestId" value={harvest.id} />;
  const moisture =
    harvest.moistureLoss ?? (harvest.dryWeight ? new Decimal(harvest.wetWeight).sub(harvest.dryWeight).toString() : null);

  return (
    <>
      <PageHeader
        title={harvest.name}
        subtitle={`${row.strainName} · ${harvest.plantCount} plant${harvest.plantCount === 1 ? "" : "s"} · harvested ${harvest.harvestedAt.toLocaleDateString("en-US", { timeZone: zone })} · ${row.roomName}`}
      />
      <CultivationTabs current="/cultivation/harvests" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <Card title="Weights">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-600">Wet weight</dt>
              <dd className="text-right font-semibold">{grams(harvest.wetWeight)}</dd>
              <dt className="text-slate-600">Dry weight</dt>
              <dd className="text-right font-semibold">{grams(harvest.dryWeight)}</dd>
              <dt className="text-slate-600">Moisture loss</dt>
              <dd className="text-right">{grams(moisture)}</dd>
              <dt className="text-slate-600">Waste</dt>
              <dd className="text-right">{grams(harvest.wasteWeight)}</dd>
              <dt className="text-slate-600">Packaged</dt>
              <dd className="text-right">{grams(harvest.packagedWeight)}</dd>
              <dt className="border-t border-slate-100 pt-2 font-semibold text-slate-900">{open ? "On hand" : "Status"}</dt>
              <dd className="border-t border-slate-100 pt-2 text-right text-lg font-bold text-slate-900">
                {open ? grams(onHand.toString()) : "finished"}
              </dd>
            </dl>
          </Card>
          {canWrite && !open ? (
            <Card title="Reopen harvest">
              <ActionForm action={reopenHarvestAction} submitLabel="Reopen harvest">
                {hidden}
                <p className="text-xs text-slate-600">Finished by mistake, or something still needs recording? Reopen it, then finish it again when it&apos;s done.</p>
                <Field label="Why it's being reopened" hint="Saved in the audit trail.">
                  <input name="reason" required maxLength={300} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : null}
          {canWrite && open ? (
            <>
              <Card title="Record dry weight">
                <ActionForm action={dryWeightAction} submitLabel="Save dry weight">
                  {hidden}
                  <Field label="Weight after drying" hint="The whole harvest, before trimming off waste.">
                    <WeightInput name="weight" unitName="unit" required remember="dry" />
                  </Field>
                </ActionForm>
              </Card>
              <Card title="Finish harvest">
                <ActionForm action={finishHarvestAction} submitLabel="Finish harvest">
                  {hidden}
                  <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-900"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Closes the harvest. Needs a dry weight, with all dried product packaged or logged as waste; the rest of the wet weight is recorded as moisture loss.</span></p>
                </ActionForm>
              </Card>
            </>
          ) : null}
        </div>

        <div className="space-y-5">
          {canWrite ? (
            <Card title="Package from this harvest">
              <ActionForm action={packageHarvestAction} submitLabel="Create package">
                {hidden}
                <Field label="New package tag (blank to generate)" hint="Leave blank and CannaTrace makes a new unique ID (PKG-000123). Or scan or type a state tag.">
                  <ScanInput name="tag" placeholder="Blank = new PKG- ID" />
                </Field>
                <CreatableSelect
                  name="itemId"
                  label="Item"
                  hint="Only items counted by weight can be packaged from a harvest."
                  required
                  placeholder="Choose an item"
                  options={weightItems.map((item) => ({ id: item.id, label: `${item.name} (${unitLabel(item.unit)})` }))}
                  create={
                    canAddItem
                      ? {
                          buttonLabel: "Add item",
                          title: "Add an item counted by weight",
                          intro: "It goes into your catalog too, and is picked for this package.",
                          submitLabel: "Save item",
                          action: quickItemAction,
                          fields: <ItemFields categories={categories} units={WEIGHT_UNITS} />,
                        }
                      : undefined
                  }
                  deniedHint="Item missing? Someone who manages the catalog can add it on the Items page."
                />
                <Field label="Quantity" hint="In the item's unit of measure.">
                  <input name="quantity" inputMode="decimal" required className={inputClass} />
                </Field>
                <CreatableSelect
                  name="locationId"
                  label="Put away to"
                  required
                  placeholder="Choose a location"
                  defaultValue={harvest.locationId}
                  options={rooms.map((r) => ({ id: r.id, label: r.name }))}
                  create={
                    canAddLocation
                      ? {
                          buttonLabel: "Add location",
                          title: "Add a location",
                          intro: "It's added to this facility's locations and picked for this package.",
                          submitLabel: "Save location",
                          action: quickLocationAction,
                          fields: <LocationFields />,
                        }
                      : undefined
                  }
                  deniedHint="Location missing? Someone who manages the catalog can add it on the Locations page."
                />
              </ActionForm>
            </Card>
          ) : null}
          <Card title="Packages made">
            {made.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing packaged yet.</p>
            ) : (
              <ScrollBox label="Packages made">
              <ul className="divide-y divide-slate-100 text-sm">
                {made.map((pkg) => (
                  <li key={pkg.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <Link href={`/inventory/${pkg.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                        {pkg.tag}
                      </Link>{" "}
                      <span className="text-slate-600">· {pkg.itemName}</span>
                    </span>
                    <span className="font-semibold">{grams(pkg.weightGrams)}</span>
                  </li>
                ))}
              </ul>
              </ScrollBox>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {canWrite ? (
            <Card title="Log waste">
              <ActionForm action={wasteAction} submitLabel="Log waste">
                {hidden}
                <Field label="Waste weight">
                  <WeightInput name="weight" unitName="unit" required remember="waste" />
                </Field>
                <Field label="What it was" hint="For example stems, fan leaves, or mold.">
                  <input name="reason" required className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : null}
          <Card title="Waste log">
            {waste.length === 0 ? (
              <p className="text-sm text-slate-600">No waste logged.</p>
            ) : (
              <ScrollBox label="Waste log">
              <ul className="divide-y divide-slate-100 text-sm">
                {waste.map((entry) => (
                  <li key={entry.id} className="py-2">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium text-slate-900">{entry.reason}</span>
                      <span className="font-semibold">{grams(entry.weightGrams)}</span>
                    </div>
                    <p className="text-slate-500">
                      {entry.userName} · {entry.createdAt.toLocaleString("en-US", { timeZone: zone })}
                    </p>
                  </li>
                ))}
              </ul>
              </ScrollBox>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
