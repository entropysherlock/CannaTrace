"use client";

import { Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const MAX = 1000;
const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="packageId"]'));

/**
 * "Print labels" for the Inventory list. Whatever is checked in the list goes to SmartLabel already chosen; with
 * nothing checked, it sends the packages shown (or opens SmartLabel empty when there are too many to send).
 */
export function CheckedLabelLink({ shownIds }: { shownIds: string[] }) {
  const router = useRouter();
  const [checked, setChecked] = useState(0);

  useEffect(() => {
    const update = () => setChecked(boxes().filter((b) => b.checked).length);
    document.addEventListener("change", update);
    const id = setTimeout(update, 0);
    return () => {
      document.removeEventListener("change", update);
      clearTimeout(id);
    };
  }, []);

  const go = () => {
    const chosen = boxes().filter((b) => b.checked).map((b) => b.value);
    const ids = (chosen.length ? chosen : shownIds).slice(0, MAX);
    const q = new URLSearchParams({ kind: "PACKAGE" });
    if (ids.length) q.set("ids", ids.join(","));
    router.push(`/labels?${q}`);
  };

  const label = checked > 0 ? `Print labels for ${checked === 1 ? "the checked package" : `the ${checked} checked`}` : shownIds.length && shownIds.length <= 100 ? `Print labels for ${shownIds.length === 1 ? "this package" : `these ${shownIds.length}`}` : "Print labels";
  return (
    <button
      type="button"
      onClick={go}
      data-testid="print-labels"
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-800 transition hover:border-brand-500"
    >
      <Tag className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
