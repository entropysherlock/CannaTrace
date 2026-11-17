import { notFound } from "next/navigation";
import { LabelDesigner } from "@/components/labels/designer";
import { PageHeader } from "@/components/ui";
import { getTemplate, LabelError } from "@/lib/labels/service";
import { requirePagePermission } from "@/lib/session";

export const instant = false;

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("labels.manage");
  const { id } = await params;
  let t;
  try {
    t = await getTemplate(session, id);
  } catch (e) {
    if (e instanceof LabelError) notFound();
    throw e;
  }
  return (
    <div>
      <PageHeader title={t.template.name} subtitle={`Version ${t.version}. Saving keeps every earlier version.`} />
      <LabelDesigner
        mode="edit"
        templateId={t.template.id}
        initial={{ name: t.template.name, kind: t.template.kind, jurisdiction: t.template.jurisdiction, design: t.design, version: t.version }}
        versions={t.versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }))}
      />
    </div>
  );
}
