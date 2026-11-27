import { CORS, OAuthError, registerClient } from "@/lib/oauth";

/** Lets an AI app introduce itself (dynamic client registration). Nothing is stored. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "The body must be JSON." }, { status: 400, headers: CORS });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "invalid_client_metadata", error_description: "The body must be a JSON object." }, { status: 400, headers: CORS });
  try {
    return Response.json(await registerClient(body as Record<string, unknown>), { status: 201, headers: CORS });
  } catch (error) {
    if (error instanceof OAuthError) return Response.json({ error: "invalid_redirect_uri", error_description: error.message }, { status: 400, headers: CORS });
    throw error;
  }
}
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
