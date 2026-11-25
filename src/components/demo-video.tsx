"use client";

import { Play, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** The narrated product tour. */
export const TOUR_VIDEO = "/tour/leaf2sale-tour.mp4";
export const TOUR_POSTER = "/tour/poster.jpg";

const OPEN_EVENT = "cannatrace:open-tour";

/** A button that opens the product tour video in the page's one player. */
export function DemoVideoButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} className={className}>
      {children}
    </button>
  );
}

/** The full-screen tour player. Render once per page; every DemoVideoButton opens it. */
export function DemoVideoPlayer() {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const open = () => {
      dialog.current?.showModal();
      if (video.current) {
        video.current.currentTime = 0;
        void video.current.play().catch(() => {});
      }
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);
  const close = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      aria-label="Leaf2Sale product tour"
      onClose={() => video.current?.pause()}
      // A click on the dark area around the video closes it.
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
      className="m-auto w-[min(92vw,1280px)] max-w-none overflow-visible bg-transparent p-0 backdrop:bg-black/80"
    >
      <div className="relative">
        <video
          ref={video}
          src={TOUR_VIDEO}
          poster={TOUR_POSTER}
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full rounded-xl bg-black shadow-2xl"
        />
        <button
          type="button"
          onClick={close}
          aria-label="Close video"
          className="absolute -top-12 right-0 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
    </dialog>
  );
}

/** The tour video's poster with a big play button; opens the same player. */
export function DemoVideoPoster() {
  return (
    <DemoVideoButton className="group relative block w-full overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/10 focus-visible:outline-4 focus-visible:outline-brand-600">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={TOUR_POSTER} alt="Leaf2Sale dashboard, the first scene of the product tour" className="aspect-video w-full object-cover" />
      <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition group-hover:bg-black/25">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-brand-800 shadow-lg transition group-hover:scale-105">
          <Play className="ml-1 h-9 w-9" aria-hidden="true" fill="currentColor" />
        </span>
      </span>
      <span className="sr-only">Play the product tour video</span>
    </DemoVideoButton>
  );
}
