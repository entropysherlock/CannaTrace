"use client";

// Shared by the phone camera screen, the desktop drop card and the drop-anywhere overlay.

const MAX_SIDE = 2400;

/** Shrinks a phone photo before it travels: a 6 MB photo becomes a few hundred KB and the text stays readable. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 400_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "The upload didn't go through.");
  return data as T;
}

export async function send(original: File, source: "phone" | "desktop" = "phone"): Promise<string> {
  const file = await shrink(original);
  const name = file.name && file.name !== "image.jpg" ? file.name : `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`;
  const { id, chunkBytes } = await jsonOrThrow<{ id: string; chunkBytes: number }>(
    await fetch("/api/assistant/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, size: file.size, source }) }),
  );
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    await jsonOrThrow(await fetch(`/api/assistant/attachments/${id}?offset=${offset}`, { method: "PUT", body: file.slice(offset, Math.min(offset + chunkBytes, file.size)) }));
  }
  await jsonOrThrow(await fetch(`/api/assistant/attachments/${id}`, { method: "POST" }));
  return id;
}

/** After a photo lands, Tally reads it straight away so the answer is waiting on the computer. */
export async function read(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/scan/${id}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    return res.ok ? String(data.summary ?? "") : null;
  } catch {
    return null;
  }
}


/** Reads a document and says why if it can't: for screens where the person is waiting on the answer. */
export async function readOrThrow(id: string): Promise<void> {
  const res = await fetch(`/api/scan/${id}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "That document couldn't be read.");
}
