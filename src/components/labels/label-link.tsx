import { Tag } from "lucide-react";
import Link from "next/link";
import type { LabelKind } from "@/lib/labels/types";

/** Opens SmartLabel with the record already chosen. The label data loads from the record; nothing is retyped. */
export function LabelLink({ kind, ids, batch, children }: { kind: LabelKind; ids?: string[]; batch?: string; children: React.ReactNode }) {
  const q = new URLSearchParams({ kind });
  if (ids?.length) q.set("ids", ids.join(","));
  if (batch) q.set("batch", batch);
  return (
    <Link href={`/labels?${q}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-800 transition hover:border-brand-500">
      <Tag className="h-4 w-4" aria-hidden="true" />
      {children}
    </Link>
  );
}
