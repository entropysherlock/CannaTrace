import { TEMPLATES, type ImportKind } from "@/lib/importer";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const template = TEMPLATES[kind as ImportKind];
  if (!template) return new Response("Unknown template.", { status: 404 });
  return new Response(template, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leaf2sale-${kind}-template.csv"` },
  });
}
