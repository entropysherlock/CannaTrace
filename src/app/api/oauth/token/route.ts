import { CORS, OAuthError, exchangeCode } from "@/lib/oauth";

const headers = { ...CORS, Pragma: "no-cache" };

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  const get = (k: string) => form.get(k) ?? "";
  try {
    if (get("grant_type") !== "authorization_code") throw new OAuthError("unsupported_grant_type", "Only authorization_code is supported.");
    const token = await exchangeCode({ code: get("code"), clientId: get("client_id"), redirectUri: get("redirect_uri"), verifier: get("code_verifier") });
    return Response.json(token, { headers });
  } catch (error) {
    if (error instanceof OAuthError) return Response.json({ error: error.code, error_description: error.message }, { status: 400, headers });
    console.error(error);
    return Response.json({ error: "server_error" }, { status: 500, headers });
  }
}
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
