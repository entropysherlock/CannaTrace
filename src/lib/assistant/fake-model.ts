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

  // Attachments: report exactly what arrived, so tests can prove files reach the model.
  if (Array.isArray(last.content) && !last.content.some((b) => b.type === "tool_result")) {
    const blocks = last.content as Anthropic.ContentBlockParam[];
    const labels = blocks.filter((b): b is Anthropic.TextBlockParam => b.type === "text" && b.text.startsWith("[Attached file"));
    const question = (blocks.filter((b) => b.type === "text").at(-1) as Anthropic.TextBlockParam | undefined)?.text.toLowerCase() ?? "";
    const id = labels[0]?.text.match(/attachment id ([\w-]+)/)?.[1];
    if (/compare/.test(question) && id) return { content: toolUse("compare_attachment_inventory", { attachment: id }), stop_reason: "tool_use" };
    const kinds = blocks.map((b) => (b.type === "image" ? `image (${(b.source as { media_type?: string }).media_type})` : b.type === "document" ? `document "${b.title}" (${(b.source as { media_type?: string }).media_type})` : b.type === "text" && b.text.startsWith("<spreadsheet") ? "spreadsheet preview" : null)).filter(Boolean);
    const gone = blocks.filter((b) => b.type === "text" && /no longer available/.test(b.text)).length;
    return say(`I received ${labels.length} file${labels.length === 1 ? "" : "s"}: ${kinds.join(", ") || "none"}.${gone ? ` ${gone} file(s) had expired.` : ""}`);
  }
  if (Array.isArray(last.content)) {
    const result = last.content.find((b) => b.type === "tool_result") as Anthropic.ToolResultBlockParam | undefined;
    const body = typeof result?.content === "string" ? result.content : "";
    if (result?.is_error) return say(`I couldn't do that: ${body}`);
    if (body.startsWith("A confirmation card")) return say("I've prepared that. Review it below and press **Confirm**.");
    const data = JSON.parse(body || "{}");
    if (data.quantity_or_status_differences)
      return say(`Compared ${data.file}: ${data.matching} match, ${data.quantity_or_status_differences.count} differ, ${data.in_file_not_in_cannatrace.count} not in CannaTrace. Nothing was changed.`);
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
  const receive = question.match(/^receive (\S+) of (.+) into (.+)$/);
  if (receive) return { content: toolUse("receive_packages", { location: receive[3].trim(), packages: [{ item: receive[2].trim(), quantity: "1", tag: receive[1].toUpperCase() }] }), stop_reason: "tool_use" };
  if (/^undo (that|it|the last (one|change))$/.test(question)) return { content: toolUse("undo_tally_change", { change: "last" }), stop_reason: "tool_use" };
  const labels = question.match(/(check|prepare) (package|product) labels? for (\S+)/);
  if (labels)
    return {
      content: toolUse(labels[1] === "check" ? "label_check" : "prepare_labels", { label_type: labels[2].toUpperCase(), refs: [labels[3].toUpperCase()] }),
      stop_reason: "tool_use",
    };
  return { content: toolUse("business_overview", {}), stop_reason: "tool_use" };
};
