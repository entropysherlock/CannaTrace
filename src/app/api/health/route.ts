import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Open health check for uptime monitors (UptimeRobot, Better Stack, and so on). It answers 200 when the
 * app can reach its database and 503 when it cannot. It shares nothing about the business: no names,
 * counts or versions.
 */
export async function GET() {
  const started = Date.now();
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return Response.json({ status: "ok", database: "ok", ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "down", database: "unreachable", ms: Date.now() - started }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
