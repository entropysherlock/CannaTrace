"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** One-click Undo for a Tally change, used on the audit trail. */
export function TallyUndoButton({ changeId }: { changeId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"ready" | "working" | "failed">("ready");
  const [message, setMessage] = useState("");
  const undo = async () => {
    setState("working");
    try {
      const res = await fetch("/api/assistant/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeId }) });
      const body = (await res.json()) as { ok?: string; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "The undo did not go through.");
      router.refresh();
    } catch (error) {
      setState("failed");
      setMessage((error as Error).message);
    }
  };
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={undo}
        disabled={state === "working"}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {state === "working" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
        Undo this
      </button>
      {state === "failed" ? <span role="alert" className="max-w-sm text-right text-xs text-red-700">{message}</span> : null}
    </span>
  );
}
