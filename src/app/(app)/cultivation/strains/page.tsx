import { asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { CultivationTabs } from "@/components/cultivation-ui";
import { Card, Field, PageHeader, inputClass, ScrollBox } from "@/components/ui";
import { strainTypeEnum, strains } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { strainAction } from "../actions";

export default async function StrainsPage() {
  const session = await requirePagePermission("cultivation.view");
  const rows = await db.select().from(strains).where(eq(strains.orgId, session.orgId)).orderBy(asc(strains.name));

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
                    <span className="text-slate-600">
                      {strain.type.toLowerCase()}
                      {strain.floweringDays ? ` · flowers in about ${strain.floweringDays} days` : ""}
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
              <Field label="Name">
                <input name="name" required className={inputClass} />
              </Field>
              <Field label="Type">
                <select name="type" required defaultValue="HYBRID" className={inputClass}>
                  {strainTypeEnum.enumValues.map((type) => (
                    <option key={type} value={type}>
                      {type === "CBD" ? "CBD" : type.charAt(0) + type.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Flowering days (optional)">
                <input name="floweringDays" inputMode="numeric" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
