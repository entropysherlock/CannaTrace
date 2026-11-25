import { NextResponse } from "next/server";
import { InventoryError } from "@/lib/inventory-math";
import { claudeModel, fakeModel, runAssistant, type AssistantEvent, type ChatMessage, type RunUsage } from "@/lib/assistant/engine";
import { explainProviderError, markHealthy, markProblem, reserveUsage, resolveTally, settleUsage } from "@/lib/ai/connection";
import { takeDemoAssistantCall } from "@/lib/demo/live-demo";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";
import { inFacilityZone } from "@/lib/time";

export const maxDuration = 60;

const OFF_MESSAGES = {
  NOT_CONNECTED: "Tally isn't connected to a Claude account yet.",
  PAUSED: "Tally is paused for this business.",
  KEY_UNREADABLE: "Tally's saved key can't be read on this server. Reconnect it in Settings → Tally AI.",
} as const;

/** Streams Tally's answer as newline-separated JSON events. Billed to the business's own Claude account. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const route = await resolveTally(session);
  if (route.kind === "off") {
    const fix = can(session, "ai.manage") ? " Set it up in Settings → Tally AI." : " Ask an owner to set it up in Settings → Tally AI.";
    return NextResponse.json({ error: OFF_MESSAGES[route.reason] + (route.reason === "KEY_UNREADABLE" ? "" : fix) }, { status: 503 });
  }
  let messages: ChatMessage[];
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    if (!Array.isArray(body.messages)) throw new Error();
    messages = body.messages;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  // Take this question's slot before calling Claude, so simultaneous questions can't all slip under the limit.
  let reservation: string;
  try {
    reservation = await reserveUsage(session, route);
  } catch (error) {
    return NextResponse.json({ error: error instanceof InventoryError ? error.message : "Tally is unavailable right now." }, { status: 429 });
  }
  // The live demo runs on Leaf2Sale's key, with its own small daily allowance.
  if (route.kind === "platform" && session.isDemo && !(await takeDemoAssistantCall(session.orgId))) {
    await settleUsage(reservation, { inputTokens: 0, outputTokens: 0, outcome: "REFUSED" });
    return NextResponse.json({ error: "Tally has answered all the live demo questions it can for today. Try again tomorrow, or create your own account." }, { status: 429 });
  }

  const model = route.kind === "fake" ? fakeModel : claudeModel(route.apiKey, route.model, route.maxTokens);
  const usage: RunUsage = { inputTokens: 0, outputTokens: 0 };
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AssistantEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let outcome = "OK";
      try {
        await inFacilityZone(session.facilityId, () => runAssistant(session, messages, emit, request.signal, model, usage));
        emit({ type: "done" });
        if (route.kind === "customer") await markHealthy(session.orgId);
      } catch (error) {
        if (request.signal.aborted) {
          outcome = "ABORTED";
        } else if (error instanceof InventoryError) {
          outcome = "ERROR";
          emit({ type: "error", message: error.message });
        } else {
          const problem = explainProviderError(error);
          outcome = problem.kind;
          // Log the kind and HTTP status only: never the request, which carries the key.
          console.error("assistant failed", problem.kind, (error as { status?: number })?.status ?? "");
          if (route.kind === "customer" && problem.kind !== "ERROR") await markProblem(session.orgId, problem);
          const who = route.kind === "platform" ? "Leaf2Sale's" : "your business's";
          emit({ type: "error", message: route.kind === "platform" && problem.kind === "NO_CREDIT" ? `Tally is temporarily unavailable (${who} AI account). Try again later.` : problem.message });
        }
      } finally {
        // Settle the reservation: a request that ended without spending tokens is released.
        await settleUsage(reservation, { ...usage, outcome }).catch(() => {});
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
