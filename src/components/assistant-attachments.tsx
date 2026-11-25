"use client";

import { FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Paperclip, Plus, X, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Attaching files to Tally: the + menu, file chips with progress, drag-and-drop, and paste.
 * Nothing uploads until a person picks, drops, or pastes a file. Files go up in pieces (the host
 * caps one request at about 4.5 MB), and the server checks and reads each one before it's usable.
 */

export type SentFile = { id: string; name: string; kind: string; size: number };
type Item = {
  key: string;
  name: string;
  size: number;
  group: Group;
  progress: number;
  status: "uploading" | "ready" | "error";
  id?: string;
  error?: string;
  preview?: string;
  note?: string;
};
type Group = "image" | "pdf" | "sheet" | "doc";

const MB = 1024 * 1024;
const TYPES: Record<string, { group: Group; limit: number }> = {
  png: { group: "image", limit: 15 * MB },
  jpg: { group: "image", limit: 15 * MB },
  jpeg: { group: "image", limit: 15 * MB },
  webp: { group: "image", limit: 15 * MB },
  pdf: { group: "pdf", limit: 20 * MB },
  csv: { group: "sheet", limit: 10 * MB },
  xlsx: { group: "sheet", limit: 10 * MB },
  docx: { group: "doc", limit: 10 * MB },
  txt: { group: "doc", limit: 2 * MB },
};
const ACCEPT: Record<Group, string> = {
  image: ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp",
  pdf: ".pdf,application/pdf",
  sheet: ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: ".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const MAX_FILES = 5;

export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < MB ? `${Math.round(n / 1024)} KB` : `${(n / MB).toFixed(1)} MB`);
const extOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? "The file couldn't be attached.");
  return body;
}

/** PUT one piece with upload progress (fetch can't report it). */
function putChunk(url: string, chunk: Blob, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try {
        reject(new Error((JSON.parse(xhr.responseText) as { error?: string }).error ?? "The upload failed."));
      } catch {
        reject(new Error("The upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check the connection and try again."));
    xhr.send(chunk);
  });
}

export function useAttachments() {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const patch = (key: string, change: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));

  const upload = useCallback(async (key: string, file: File) => {
    try {
      const { id, chunkBytes } = await json<{ id: string; chunkBytes: number }>(
        await fetch("/api/assistant/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size }) }),
      );
      patch(key, { id });
      for (let offset = 0; offset < file.size; offset += chunkBytes) {
        const piece = file.slice(offset, Math.min(offset + chunkBytes, file.size));
        await putChunk(`/api/assistant/attachments/${id}?offset=${offset}`, piece, (sent) => patch(key, { progress: Math.min(0.95, (offset + sent) / file.size) }));
      }
      const info = await json<{ kind: string; meta: { pages?: number; sheets?: { totalRows: number }[]; warnings?: string[] } }>(await fetch(`/api/assistant/attachments/${id}`, { method: "POST" }));
      const rows = info.meta.sheets?.reduce((t, s) => t + s.totalRows, 0);
      patch(key, {
        status: "ready",
        progress: 1,
        note: info.meta.pages ? `${info.meta.pages} page${info.meta.pages === 1 ? "" : "s"}` : rows !== undefined ? `${rows.toLocaleString("en-US")} rows` : info.meta.warnings?.[0],
      });
    } catch (error) {
      patch(key, { status: "error", error: (error as Error).message });
    }
  }, []);

  const add = useCallback(
    (files: File[]) => {
      setNotice(null);
      const room = MAX_FILES - itemsRef.current.filter((i) => i.status !== "error").length;
      if (files.length > room) setNotice(`Up to ${MAX_FILES} files per message.${room > 0 ? ` Only the first ${room} ${room === 1 ? "was" : "were"} added.` : ""}`);
      for (const original of files.slice(0, Math.max(room, 0))) {
        // Pasted screenshots arrive as "image.png" with no useful name.
        const file = original.name && original.name !== "image.png" ? original : new File([original], `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`, { type: original.type });
        const type = TYPES[extOf(file.name)];
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const base: Item = { key, name: file.name, size: file.size, group: type?.group ?? "doc", progress: 0, status: "uploading" };
        if (!type) {
          setItems((l) => [...l, { ...base, status: "error", error: "Tally can read PNG, JPG, WEBP, PDF, DOCX, TXT, CSV, and XLSX files." }]);
          continue;
        }
        if (file.size > type.limit) {
          setItems((l) => [...l, { ...base, status: "error", error: `Too large (${formatSize(file.size)}). The limit for this kind of file is ${formatSize(type.limit)}.` }]);
          continue;
        }
        if (file.size === 0) {
          setItems((l) => [...l, { ...base, status: "error", error: "The file is empty." }]);
          continue;
        }
        setItems((l) => [...l, { ...base, preview: type.group === "image" ? URL.createObjectURL(file) : undefined }]);
        void upload(key, file);
      }
    },
    [upload],
  );

  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((i) => i.key === key);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    if (item?.id) void fetch(`/api/assistant/attachments/${item.id}`, { method: "DELETE" }).catch(() => {});
    setItems((l) => l.filter((i) => i.key !== key));
    setNotice(null);
  }, []);

  /** Hand the ready files to a message and clear the tray (files stay on the server for the conversation). */
  const take = useCallback((): SentFile[] => {
    const ready = itemsRef.current.filter((i) => i.status === "ready" && i.id);
    itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    setItems([]);
    setNotice(null);
    return ready.map((i) => ({ id: i.id!, name: i.name, kind: i.group, size: i.size }));
  }, []);

  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  return {
    items,
    notice,
    add,
    remove,
    take,
    uploading: items.some((i) => i.status === "uploading"),
    ready: items.filter((i) => i.status === "ready").length,
  };
}

export const FileGlyph = ({ group, className }: { group: string; className?: string }) => {
  const Icon = group === "image" ? ImageIcon : group === "sheet" ? FileSpreadsheet : group === "pdf" || group === "doc" ? FileText : Paperclip;
  return <Icon className={className} aria-hidden="true" />;
};

/** The + button and its menu. */
export function AttachButton({ disabled, onFiles, retentionHours }: { disabled: boolean; onFiles: (files: File[]) => void; retentionHours: number }) {
  const [open, setOpen] = useState(false);
  const inputs = useRef<Record<Group, HTMLInputElement | null>>({ image: null, pdf: null, sheet: null, doc: null });
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const choices: { group: Group; label: string; hint: string }[] = [
    { group: "image", label: "Upload image", hint: "PNG, JPG, WEBP · photo or screenshot" },
    { group: "pdf", label: "Upload PDF", hint: "Up to 100 pages" },
    { group: "sheet", label: "Upload spreadsheet", hint: "CSV or XLSX" },
    { group: "doc", label: "Upload document", hint: "DOCX or TXT" },
  ];
  return (
    <div
      ref={wrap}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Attach files"
        title="Attach files"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 transition hover:bg-brand-50 hover:text-brand-800 disabled:opacity-40"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" aria-label="Attach" className="absolute bottom-11 left-0 z-10 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl" data-attach-menu>
          {choices.map((c, i) => (
            <button
              key={c.group}
              type="button"
              role="menuitem"
              autoFocus={i === 0}
              onClick={() => {
                setOpen(false);
                inputs.current[c.group]?.click();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
            >
              <FileGlyph group={c.group} className="h-4 w-4 shrink-0 text-brand-700" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{c.label}</span>
                <span className="block text-xs text-slate-500">{c.hint}</span>
              </span>
            </button>
          ))}
          <p className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 text-[11px] leading-snug text-slate-500">
            Files are sent to Anthropic&apos;s Claude to be read, on your business&apos;s Claude account. Leaf2Sale deletes them after {retentionHours} hour{retentionHours === 1 ? "" : "s"}. You can also drag files here or paste a screenshot.
          </p>
        </div>
      ) : null}
      {(Object.keys(ACCEPT) as Group[]).map((g) => (
        <input
          key={g}
          ref={(el) => {
            inputs.current[g] = el;
          }}
          type="file"
          multiple
          accept={ACCEPT[g]}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          data-attach-input={g}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
      ))}
    </div>
  );
}

/** Chips for files waiting to be sent: name, size, progress, and a remove button. */
export function AttachmentChips({ items, notice, onRemove }: { items: Item[]; notice: string | null; onRemove: (key: string) => void }) {
  if (!items.length && !notice) return null;
  return (
    <div className="mb-2 space-y-1.5" aria-live="polite">
      <ul className="flex flex-wrap gap-2" aria-label="Attached files">
        {items.map((i) => (
          <li
            key={i.key}
            data-attachment-chip={i.status}
            className={`relative flex max-w-full items-center gap-2 overflow-hidden rounded-xl border py-1.5 pl-1.5 pr-1 text-xs ${i.status === "error" ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}
          >
            {i.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.preview} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-brand-700">
                {i.status === "error" ? <AlertCircle className="h-4 w-4 text-red-600" aria-hidden="true" /> : <FileGlyph group={i.group} className="h-4 w-4" />}
              </span>
            )}
            <span className="min-w-0">
              <span className="block max-w-[11rem] truncate font-semibold text-slate-900" title={i.name}>
                {i.name}
              </span>
              <span className={`block ${i.status === "error" ? "max-w-[15rem] whitespace-normal text-red-700" : "text-slate-500"}`}>
                {i.status === "error" ? i.error : i.status === "uploading" ? `${formatSize(i.size)} · ${Math.round(i.progress * 100)}%` : [formatSize(i.size), i.note].filter(Boolean).join(" · ")}
              </span>
            </span>
            {i.status === "uploading" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-700" aria-label={`Uploading ${i.name}`} /> : null}
            <button type="button" onClick={() => onRemove(i.key)} aria-label={`Remove ${i.name}`} className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-900">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {i.status === "uploading" ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-100" aria-hidden="true">
                <span className="block h-full bg-brand-600 transition-all" style={{ width: `${Math.round(i.progress * 100)}%` }} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {notice ? <p className="text-xs font-medium text-amber-800">{notice}</p> : null}
    </div>
  );
}
