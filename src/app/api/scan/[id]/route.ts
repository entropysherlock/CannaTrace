import { NextResponse } from "next/server";
import { InventoryError } from "@/lib/inventory-math";
import { readAttachment } from "@/lib/scan/read";
import { currentSession } from "@/lib/session";

export const maxDuration = 120;

/** Read a photo or PDF the person uploaded and fill in a form from it. Nothing is saved until they confirm. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await params;
  try {
    const scan = await readAttachment(session, id);
    return NextResponse.json({ id: scan.id, kind: scan.kind, status: scan.status, summary: summarize(scan.proposal) });
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("scan read failed", (error as Error)?.name);
    return NextResponse.json({ error: "That document couldn't be read. Try again." }, { status: 500 });
  }
}

type Proposal = Awaited<ReturnType<typeof readAttachment>>["proposal"];
function summarize(p: Proposal): string {
  if (p.kind === "OTHER") return p.summary;
  const bits = [p.identifiers.product, p.values.thcPercent ? `THC ${p.values.thcPercent}%` : "", p.values.result ? p.values.result.toLowerCase() : ""].filter(Boolean);
  return `Lab certificate${bits.length ? `: ${bits.join(" · ")}` : ""}`;
}
