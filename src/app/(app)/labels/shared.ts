import "server-only";
import { and, eq } from "drizzle-orm";
import { facilities } from "@/db/schema";
import { db } from "@/lib/db";
import { actorOf } from "@/lib/labels/http";
import { ensureStarterTemplates } from "@/lib/labels/service";
import type { Session } from "@/lib/session";

/** Every SmartLabel page makes sure the facility has its starter templates. */
export async function prepareLabels(session: Session) {
  const [f] = await db.select({ state: facilities.state }).from(facilities).where(and(eq(facilities.id, session.facilityId), eq(facilities.orgId, session.orgId)));
  const state = f?.state ?? "";
  await ensureStarterTemplates(actorOf(session), state);
  return { state };
}

export const mm = (n: number) => String(Number(n.toFixed(2)));
export const sizeLabel = (w: number, h: number) => `${mm(w)}×${mm(h)} mm`;
