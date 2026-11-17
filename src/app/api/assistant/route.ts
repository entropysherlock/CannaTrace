import { NextResponse } from "next/server";
import { InventoryError } from "@/lib/inventory-math";
import { assistantEnabled, runAssistant, type AssistantEvent, type ChatMessage } from "@/lib/assistant/engine";
import { currentSession } from "@/lib/session";
import { takeDemoAssistantCall } from "@/lib/demo/live-demo";

export const maxDuration = 60;

/** Streams the assistant's answer as newline-separated JSON events. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!assistantEnabled()) return NextResponse.json({ error: "The assistant is not turned on yet." }, { status: 503 });
  if (session.isDemo && !(await takeDemoAssistantCall(session.orgId)))
    return NextResponse.json({ error: "Tally has answered all the live demo questions it can for today. Try again tomorrow, or create your own account." }, { status: 429 });
  let messages: ChatMessage[];
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    if (!Array.isArray(body.messages)) throw new Error();
    messages = body.messages;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AssistantEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await runAssistant(session, messages, emit, request.signal);
        emit({ type: "done" });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("assistant failed", error);
          const status = (error as { status?: number }).status;
          emit({
            type: "error",
            message:
              error instanceof InventoryError
                ? error.message
                : status === 401
                  ? "The assistant's API key was not accepted. An owner should check it in Vercel."
                  : status === 429
                    ? "The assistant is busy or has hit its spending limit. Try again in a minute."
                    : "Something went wrong reaching the assistant. Try again.",
          });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
