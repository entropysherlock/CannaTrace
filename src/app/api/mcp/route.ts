import { API_REQUESTS_PER_MINUTE, takeApiRequest } from "@/lib/api";
import { authenticateApiKey } from "@/lib/integrations";
import { handleMcp } from "@/lib/mcp";

/** MCP over HTTP (stateless). Sign in with an API key: Authorization: Bearer ct_... */
const headers = { "Cache-Control": "no-store" };
const rpcError = (status: number, code: number, message: string, extra: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { ...headers, ...extra } });

export async function POST(request: Request) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return rpcError(401, -32001, "Send a valid API key as: Authorization: Bearer ct_...", { "WWW-Authenticate": "Bearer" });
  if (!(await takeApiRequest(key.id)))
    return rpcError(429, -32002, `Each API key may make ${API_REQUESTS_PER_MINUTE} requests a minute; wait a moment and try again.`, { "Retry-After": "30" });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return rpcError(400, -32700, "The request body must be valid JSON.");
  }
  const batch = Array.isArray(body);
  const messages: unknown[] = (Array.isArray(body) ? body : [body]).slice(0, 20);
  const replies = (await Promise.all(messages.map((m) => (m && typeof m === "object" ? handleMcp(m as Parameters<typeof handleMcp>[0], key) : null)))).filter((r: unknown) => r !== null);
  if (!replies.length) return new Response(null, { status: 202, headers });
  return Response.json(batch ? replies : replies[0], { headers });
}

// No server-sent streams: this connector only answers requests.
export const GET = () => new Response("Use POST.", { status: 405, headers: { ...headers, Allow: "POST" } });
export const DELETE = () => new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
