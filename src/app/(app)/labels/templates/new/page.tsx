import { LabelDesigner } from "@/components/labels/designer";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/session";

export const instant = false;

export default async function NewTemplatePage() {
  await requirePagePermission("labels.manage");
  return (
    <div>
      <PageHeader title="New label template" />
      <LabelDesigner
        mode="new"
        initial={{
          name: "",
          kind: "PACKAGE",
          jurisdiction: null,
          version: 0,
          design: {
            widthMm: 101.6,
            heightMm: 50.8,
            elements: [
              { id: "e1", type: "text", x: 4, y: 3, w: 93.6, h: 6, text: "{{item.name}}", fontSize: 13, bold: true },
              { id: "e2", type: "barcode", x: 2, y: 14, w: 97.6, h: 14, value: "{{package.tag}}", format: "code128" },
              { id: "e3", type: "text", x: 4, y: 30, w: 93.6, h: 5, text: "{{package.tag}}", fontSize: 11, align: "center" },
            ],
          },
        }}
      />
    </div>
  );
}
