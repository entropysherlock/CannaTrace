import { asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { CultivationTabs, StrainFields } from "@/components/cultivation-ui";
import { Card, PageHeader, ScrollBox } from "@/components/ui";
import { strains } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { strainAction, strainTimingAction } from "../actions";

export default async function StrainsPage() {
  const session = await requirePagePermission("cultivation.view");
  const rows = await db.select().from(strains).where(eq(strains.orgId, session.orgId)).orderBy(asc(strains.name));
  const canEdit = can(session, "cultivation.write");

  return (
    <>
      <PageHeader title="Strains" subtitle="Shared across all of your facilities." />
      <CultivationTabs current="/cultivation/strains" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`${rows.length} strain${rows.length === 1 ? "" : "s"}`}>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-600">No strains yet.</p>
            ) : (
              <ScrollBox label="Strains">
              <ul className="divide-y divide-slate-100 text-sm">
                {rows.map((strain) => (
                  <li key={strain.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-medium text-slate-900">{strain.name}</span>
                    <span className="text-right text-slate-600">
                      {strain.type.toLowerCase()}
                      {strain.vegDays ? ` · veg ${strain.vegDays} days` : ""}
                      {strain.floweringDays ? ` · flowers in about ${strain.floweringDays} days` : ""}
                      {canEdit ? (
                        <details className="mt-1 text-left" data-testid={`timing-${strain.name}`}>
                          <summary className="cursor-pointer text-xs font-semibold text-brand-700">Set timing</summary>
                          <ActionForm action={strainTimingAction} submitLabel="Save timing" quiet className="mt-2 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="strainId" value={strain.id} />
                            <label className="text-xs font-semibold text-slate-700">
                              Veg days
                              <input name="timingVeg" inputMode="numeric" defaultValue={strain.vegDays ?? ""} className="mt-1 block w-24 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                            </label>
                            <label className="text-xs font-semibold text-slate-700">
                              Flowering days
                              <input name="timingFlower" inputMode="numeric" defaultValue={strain.floweringDays ?? ""} className="mt-1 block w-24 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                            </label>
                          </ActionForm>
                        </details>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              </ScrollBox>
            )}
          </Card>
        </div>
        {can(session, "cultivation.write") ? (
          <Card title="Add a strain">
            <ActionForm action={strainAction} submitLabel="Add strain">
              <StrainFields />
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
