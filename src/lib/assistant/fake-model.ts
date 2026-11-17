import type Anthropic from "@anthropic-ai/sdk";
import type { Model } from "./engine";

/**
 * A stand-in for Claude used only by automated tests (ASSISTANT_FAKE=1), so the panel, tools,
 * and confirm flow can be tested without an API key. It follows a fixed script.
 */
export const fakeModel: Model = async ({ messages }, onText) => {
  const last = messages[messages.length - 1];
  const toolUse = (name: string, input: object): Anthropic.ContentBlock[] => [
    { type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock,
  ];
  const say = (text: string) => {
    for (const word of text.split(/(?<= )/)) onText(word);
    return { content: [{ type: "text", text, citations: null } as Anthropic.ContentBlock], stop_reason: "end_turn" };
  };

  if (Array.isArray(last.content)) {
    const result = last.content.find((b) => b.type === "tool_result") as Anthropic.ToolResultBlockParam | undefined;
    const body = typeof result?.content === "string" ? result.content : "";
    if (result?.is_error) return say(`I couldn't do that: ${body}`);
    if (body.startsWith("A confirmation card")) return say("I've prepared that. Review it below and press **Confirm**.");
    const data = JSON.parse(body || "{}");
    if (Array.isArray(data.findings)) {
      const lines = data.findings.filter((f: { severity: string }) => f.severity !== "info").map((f: { message: string }) => `- ${f.message}`);
      return say(`Checked ${data.labels} label(s) with ${data.template}. ${data.can_print ? "They can print." : `They can't print yet (${data.blocking} blocking).`}\n\n${lines.join("\n")}`);
    }
    return say(
      `Here's where things stand:\n\n| Measure | Count |\n|---|---|\n| Packages in stock | ${data.packages_in_stock} |\n| On hold | ${data.packages_on_hold} |\n| Tagged plants | ${data.tagged_plants} |`,
    );
  }
  const question = String(last.content).toLowerCase();
  const move = question.match(/move (\S+) to (.+)$/);
  if (move) return { content: toolUse("move_package", { tag: move[1], to_location: move[2].trim() }), stop_reason: "tool_use" };
  const bulk = question.match(/change category of (.+) to (.+)$/);
  if (bulk) return { content: toolUse("bulk_edit_items", { match: { name_contains: bulk[1].trim() }, changes: { category: bulk[2].trim() } }), stop_reason: "tool_use" };
  const labels = question.match(/(check|prepare) (package|product) labels? for (\S+)/);
  if (labels)
    return {
      content: toolUse(labels[1] === "check" ? "label_check" : "prepare_labels", { label_type: labels[2].toUpperCase(), refs: [labels[3].toUpperCase()] }),
      stop_reason: "tool_use",
    };
  return { content: toolUse("business_overview", {}), stop_reason: "tool_use" };
};
