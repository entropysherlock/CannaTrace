"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function InboxDelete({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/assistant/attachments/${id}`, { method: "DELETE" }).catch(() => {});
        router.refresh();
      }}
      className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
    >
      Delete
    </button>
  );
}
