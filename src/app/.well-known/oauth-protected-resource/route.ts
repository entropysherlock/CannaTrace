import { CORS, metadata } from "@/lib/oauth";

export const GET = () => Response.json(metadata.resource(), { headers: CORS });
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
