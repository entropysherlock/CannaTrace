import "server-only";
import { NextResponse } from "next/server";
import { can, type Permission } from "@/lib/rbac";
import { currentSession, type Session } from "@/lib/session";
import { LabelDataError } from "./data";
import { DesignError } from "./design";
import { LabelError, type LabelActor } from "./service";

export function actorOf(s: Session): LabelActor {
  return { orgId: s.orgId, facilityId: s.facilityId, userId: s.userId, userName: s.name };
}

/**
 * Run a label API request: signed in, allowed, and with label errors turned into plain JSON
 * messages. Unexpected errors never leak details.
 */
export async function labelRoute(permission: Permission, fn: (session: Session) => Promise<Response>): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!can(session, permission)) return NextResponse.json({ error: "Your role does not allow this. Ask an owner or manager for access." }, { status: 403 });
  try {
    return await fn(session);
  } catch (e) {
    if (e instanceof LabelError) return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    if (e instanceof LabelDataError || e instanceof DesignError) return NextResponse.json({ error: e.message, issues: [] }, { status: 422 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong on our side. Nothing was printed or changed." }, { status: 500 });
  }
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new LabelError("The request was not valid JSON.");
  }
}

export const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
