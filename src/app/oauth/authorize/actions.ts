"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { facilities } from "@/db/schema";
import { db } from "@/lib/db";
import { OAuthError, makeCode, parseAuthorize } from "@/lib/oauth";
import { can } from "@/lib/rbac";
import { requireSession } from "@/lib/session";

const back = (uri: string, params: Record<string, string>) => {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
};

/** Approve or deny. Every check runs again here, so nothing on the page can be altered to get around them. */
export async function decide(formData: FormData): Promise<void> {
  const field = (k: string) => String(formData.get(k) ?? "");
  let req;
  try {
    req = await parseAuthorize({
      client_id: field("client_id"),
      redirect_uri: field("redirect_uri"),
      response_type: "code",
      code_challenge: field("code_challenge"),
      code_challenge_method: "S256",
      state: field("state"),
    });
  } catch (error) {
    redirect(`/oauth/authorize/error?m=${encodeURIComponent(error instanceof OAuthError ? error.message : "Something went wrong.")}`);
  }
  if (field("decision") !== "approve") redirect(back(req.redirectUri, { error: "access_denied", state: req.state }));

  const session = await requireSession();
  if (session.isDemo || !can(session, "integrations.manage")) redirect(back(req.redirectUri, { error: "access_denied", state: req.state }));
  const [facility] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, session.facilityId));
  if (!facility) redirect(back(req.redirectUri, { error: "access_denied", state: req.state }));
  const code = await makeCode(req, { orgId: session.orgId, facilityId: session.facilityId, userId: session.userId, userName: session.name, canWrite: formData.get("canWrite") === "on" });
  redirect(back(req.redirectUri, { code, state: req.state }));
}
