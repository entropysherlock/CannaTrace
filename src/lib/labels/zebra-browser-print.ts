/**
 * Talking to Zebra Browser Print: the free app Zebra publishes that runs on the computer next to the printer and
 * accepts print jobs from a web page on that same computer (USB or network printers). Browser only.
 */

export type ZebraDevice = { name: string; uid: string; connection: string; deviceType: string; provider: string; manufacturer: string; version: number };

/** Where Browser Print listens. Plain http first (browsers allow it for this computer), then its secure port. */
const BASES = ["http://localhost:9100", "https://localhost:9101"];

export class ZebraError extends Error {}

const NOT_RUNNING =
  "Can't reach Zebra Browser Print on this computer. Install the free Zebra Browser Print app from Zebra's website, start it, and try again. You can still use Open PDF in the meantime.";

async function call(base: string, path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    return await fetch(`${base}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The address Browser Print answers on, or an error that says how to fix it. */
async function reach(): Promise<string> {
  for (const base of BASES) {
    try {
      const res = await call(base, "/available");
      if (res.ok) return base;
    } catch {
      // try the next address
    }
  }
  throw new ZebraError(NOT_RUNNING);
}

/** Pick the printer to use: the one named like the saved printer, else the app's default, else the only one. */
export async function findPrinter(preferredName: string): Promise<{ base: string; device: ZebraDevice }> {
  const base = await reach();
  const list = (await (await call(base, "/available")).json().catch(() => ({}))) as { printer?: ZebraDevice[] };
  const printers = (list.printer ?? []).filter((d) => d.deviceType === "printer" || !d.deviceType);
  if (!printers.length) throw new ZebraError("Zebra Browser Print is running but can't see a Zebra printer. Check the printer is on and plugged in, then add it in Browser Print.");
  const wanted = preferredName.trim().toLowerCase();
  const byName = printers.find((d) => d.name.toLowerCase() === wanted);
  if (byName) return { base, device: byName };
  const fallback = (await call(base, "/default").then((r) => r.json()).catch(() => null)) as ZebraDevice | null;
  const byDefault = fallback?.uid ? printers.find((d) => d.uid === fallback.uid) : undefined;
  return { base, device: byDefault ?? printers[0] };
}

/** Send ZPL to the printer. Resolves when Browser Print has accepted it. */
export async function sendZpl(target: { base: string; device: ZebraDevice }, zpl: string): Promise<void> {
  let res: Response;
  try {
    // A plain text body keeps this a simple request, which Browser Print answers without a pre-check.
    res = await call(target.base, "/write", { method: "POST", body: JSON.stringify({ device: target.device, data: zpl }) });
  } catch {
    throw new ZebraError(NOT_RUNNING);
  }
  if (!res.ok) throw new ZebraError("The Zebra printer didn't accept the labels. Check it has paper and the lid is closed, then try again.");
}
