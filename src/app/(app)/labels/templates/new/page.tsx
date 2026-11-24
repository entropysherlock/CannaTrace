import { NewTemplateStart } from "@/components/labels/new-template-start";
import { PageHeader } from "@/components/ui";
import { tallyAvailability } from "@/lib/ai/connection";
import { catalog } from "@/lib/labels/catalog";
import { listTemplates } from "@/lib/labels/service";
import { requirePagePermission } from "@/lib/session";
import { prepareLabels } from "../../shared";

export const instant = false;

export default async function NewTemplatePage() {
  const session = await requirePagePermission("labels.manage");
  const { state } = await prepareLabels(session);
  const [mine, ai] = await Promise.all([listTemplates(session), tallyAvailability(session)]);
  return (
    <div className="space-y-5">
      <PageHeader title="New label template" subtitle="Upload a label you already use and CannaTrace rebuilds it, or start from a ready-made template." />
      <NewTemplateStart
        starters={catalog(state)}
        mine={mine.map((t) => ({ id: t.id, name: t.name, kind: t.kind, jurisdiction: t.jurisdiction, design: t.design }))}
        aiReady={ai.ready}
        aiReason={ai.reason}
      />
    </div>
  );
}
