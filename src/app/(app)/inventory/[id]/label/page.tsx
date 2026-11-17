import { redirect } from "next/navigation";

/** The old single-label page. Package labels now print from SmartLabel, with checks and a job history. */
export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/labels?kind=PACKAGE&ids=${encodeURIComponent(id)}`);
}
