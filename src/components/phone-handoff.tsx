"use client";

import { Smartphone } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Incoming = { id: string; kind: string; label: string };

/**
 * When a photo from this person's phone has been read, open its review screen here. A short countdown with a way
 * to stay put keeps it from yanking someone out of what they are typing.
 */
export function PhoneHandoff() {
  const router = useRouter();
  const path = usePathname();
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [left, setLeft] = useState(3);
  const since = useRef<string | null>(null);
  const showing = useRef(false);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (document.visibilityState !== "visible" || showing.current) return;
      try {
        const res = await fetch(`/api/scan/incoming${since.current ? `?since=${encodeURIComponent(since.current)}` : ""}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const data = (await res.json()) as { now: string; incoming: Incoming | null };
        since.current = data.now;
        if (data.incoming && !showing.current) {
          showing.current = true;
          setLeft(3);
          setIncoming(data.incoming);
        }
      } catch {
        // Offline or asleep: the next tick tries again.
      }
    };
    void poll();
    const timer = setInterval(poll, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const open = incoming && incoming.kind !== "OTHER";
  const there = incoming ? path === `/inbox/${incoming.id}` : false;
  useEffect(() => {
    if (!incoming) return;
    // Already looking at it, or time's up: act on the next tick rather than inside the effect.
    const t = setTimeout(
      () => {
        if (there) {
          showing.current = false;
          setIncoming(null);
        } else if (open && left <= 0) {
          showing.current = false;
          setIncoming(null);
          router.push(`/inbox/${incoming.id}`);
        } else if (open) setLeft((n) => n - 1);
      },
      there || (open && left <= 0) ? 0 : 1000,
    );
    return () => clearTimeout(t);
  }, [incoming, left, open, there, router]);

  if (!incoming || there) return null;
  const close = () => {
    showing.current = false;
    setIncoming(null);
  };
  return (
    <div role="status" data-testid="phone-handoff" className="fixed bottom-24 left-1/2 z-[60] w-[min(92vw,26rem)] -translate-x-1/2 rounded-2xl bg-brand-800 p-4 text-white shadow-2xl print:hidden sm:bottom-6">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{open ? `Your phone sent a ${incoming.label}` : "Your phone sent a document"}</p>
          <p className="text-sm text-brand-100">{open ? `Opening it in ${left}…` : "Tally didn't recognise it, but it is in your phone inbox."}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => { close(); router.push(`/inbox/${incoming.id}`); }} className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-bold text-brand-900">
          Open now
        </button>
        <button type="button" onClick={close} className="rounded-lg bg-white/15 px-3 py-2 text-sm font-bold">
          {open ? "Stay here" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
