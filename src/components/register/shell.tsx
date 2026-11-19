"use client";

import { Banknote, LogOut, Maximize2, Minimize2, MonitorSmartphone, Settings2, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { LeafMark } from "@/components/logo";
import { isMuted, setMuted, subscribeMuted } from "./feedback";

export type ShellInfo = {
  storeName: string;
  clerkName: string;
  drawerLine: string;
  canManage: boolean;
  /** The store's time zone, so the clock matches every other time on the register. */
  timeZone: string;
};

/** The store's time, not the device's: a tablet set to the wrong zone still shows the same time as the receipts. */
function Clock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return <span className="tabular-nums">{now ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }) : ""}</span>;
}

const barButton =
  "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-brand-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-brand-200";

/** The register runs full-window, like a dedicated terminal. Everything else in CannaTrace is one tap away. */
export function RegisterShell({ info, children }: { info: ShellInfo; children: ReactNode }) {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const full = useSyncExternalStore(
    (notify) => {
      document.addEventListener("fullscreenchange", notify);
      return () => document.removeEventListener("fullscreenchange", notify);
    },
    () => Boolean(document.fullscreenElement),
    () => false,
  );

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#eef3ef] text-slate-900 print:static print:bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-brand-950 px-3 text-white print:hidden">
        <Link href="/pos" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/10" title="Register home">
          <LeafMark className="h-7 w-7 text-brand-200" />
          <span className="font-display text-lg font-bold tracking-tight">Register</span>
        </Link>
        <div className="hidden min-w-0 flex-1 items-center gap-3 truncate text-sm text-brand-100 md:flex">
          <span className="truncate font-semibold text-white">{info.storeName}</span>
          <span className="truncate">{info.drawerLine}</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="hidden px-2 text-sm text-brand-100 lg:inline">
            {info.clerkName} · <Clock timeZone={info.timeZone} />
          </span>
          <a href="/pos/display" target="ct-customer-display" className={barButton} title="Open the customer-facing screen in a new window">
            <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />
            <span className="hidden xl:inline">Customer screen</span>
          </a>
          <Link href="/pos/drawer" className={barButton} title="Cash drawer">
            <Banknote className="h-5 w-5" aria-hidden="true" />
            <span className="hidden xl:inline">Drawer</span>
          </Link>
          {info.canManage ? (
            <Link href="/pos/menu" className={barButton} title="Menu, prices, and store rules">
              <Settings2 className="h-5 w-5" aria-hidden="true" />
              <span className="hidden xl:inline">Menu</span>
            </Link>
          ) : null}
          <button
            type="button"
            className={barButton}
            onClick={() => {
              setMuted(!muted);
            }}
            aria-pressed={muted}
            title={muted ? "Turn scan sounds on" : "Turn scan sounds off"}
          >
            {muted ? <VolumeX className="h-5 w-5" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
            <span className="sr-only">{muted ? "Sounds off" : "Sounds on"}</span>
          </button>
          <button type="button" className={barButton} onClick={toggleFull} title={full ? "Leave full screen" : "Full screen"}>
            {full ? <Minimize2 className="h-5 w-5" aria-hidden="true" /> : <Maximize2 className="h-5 w-5" aria-hidden="true" />}
            <span className="sr-only">{full ? "Leave full screen" : "Full screen"}</span>
          </button>
          <Link href="/dashboard" className={`${barButton} ml-1 border border-white/15`}>
            <LogOut className="h-5 w-5" aria-hidden="true" />
            <span>Exit</span>
          </Link>
        </div>
      </header>
      <div className="min-h-0 flex-1 print:overflow-visible">{children}</div>
    </div>
  );
}

/** A short message that slides in at the bottom and fades out: what a scan added, or what went wrong. */
export type Toast = { id: number; tone: "ok" | "error"; text: string };

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-5 z-[80] flex w-[min(calc(100vw-2.5rem),520px)] flex-col gap-2">
      {toasts.map((t) => (
        <p
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={`rounded-xl px-4 py-3 text-base font-semibold shadow-lg ${t.tone === "error" ? "bg-red-700 text-white" : "bg-brand-900 text-white"}`}
        >
          {t.text}
        </p>
      ))}
    </div>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), tone === "error" ? 6000 : 2200);
  };
  return { toasts, push };
}
