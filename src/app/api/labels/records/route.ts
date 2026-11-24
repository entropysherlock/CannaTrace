import { NextResponse } from "next/server";
import { labelCandidates, loadLabelRecords } from "@/lib/labels/data";
import { labelRoute } from "@/lib/labels/http";
import { LabelError } from "@/lib/labels/service";
import { LABEL_KINDS, type LabelKind } from "@/lib/labels/types";

/**
 * Real records for the designer's "preview with a real package": no id lists the recent records of that label type,
 * an id returns that record's field values. Read only; it belongs to the signed-in facility.
 */
export async function GET(req: Request) {
  return labelRoute("labels.manage", async (session) => {
    const url = new URL(req.url);
    const kind = String(url.searchParams.get("kind") ?? "") as LabelKind;
    if (!LABEL_KINDS.some((k) => k.kind === kind)) throw new LabelError("Choose a label type.");
    const scope = { orgId: session.orgId, facilityId: session.facilityId };
    const id = url.searchParams.get("id");
    if (id) {
      const [record] = await loadLabelRecords(scope, kind, [id]);
      if (!record) throw new LabelError("That record was not found at this facility.");
      return NextResponse.json({ ref: record.ref, sourceId: record.sourceId, values: record.values });
    }
    const all = await labelCandidates(scope);
    return NextResponse.json({ records: all[kind].slice(0, 200) });
  });
}
