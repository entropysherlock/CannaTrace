import { NextResponse } from "next/server";
import { actorOf, jsonBody, labelRoute, strList } from "@/lib/labels/http";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { previewLabels } from "@/lib/labels/service";

/** Check real records against a template and return previews. Creates nothing. */
export async function POST(req: Request) {
  return labelRoute("labels.print", async (session) => {
    const body = await jsonBody(req);
    const p = await previewLabels(actorOf(session), String(body.templateId ?? ""), strList(body.sourceIds));
    return NextResponse.json({
      template: { id: p.template.id, name: p.template.name, kind: p.template.kind, jurisdiction: p.template.jurisdiction, version: p.version },
      size: { widthMm: p.design.widthMm, heightMm: p.design.heightMm },
      count: p.records.length,
      // Which chosen record each label reference belongs to, so the page can link a problem to its record.
      records: p.records.map((r) => ({ ref: r.ref, sourceId: r.sourceId })),
      previews: p.records.slice(0, 12).map((r) => ({ ref: r.ref, svg: renderLabelSvg(p.design, r.values) })),
      issues: p.issues,
      blocked: p.blocked,
      pack: p.pack ? { state: p.pack.state, name: p.pack.name, source: p.pack.source, url: p.pack.url, checked: p.pack.checked } : null,
      checkedRules: p.checkedRules,
      manualRules: p.manualRules,
    });
  });
}
