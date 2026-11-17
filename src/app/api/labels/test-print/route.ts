import { actorOf, labelRoute } from "@/lib/labels/http";
import { testPrint } from "@/lib/labels/service";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return labelRoute("labels.print", async (session) => {
    const pdf = await testPrint(actorOf(session), {
      widthMm: Number(url.searchParams.get("widthMm")),
      heightMm: Number(url.searchParams.get("heightMm")),
      printerId: url.searchParams.get("printerId"),
    });
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="test-label.pdf"', "Cache-Control": "no-store" } });
  });
}
