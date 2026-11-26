"use client";

import { Play } from "lucide-react";
import { useRef, useState } from "react";

export const TALLY_VIDEO = "/tour/tally.mp4";
export const TALLY_POSTER = "/tour/tally-poster.jpg";

/**
 * The Tally showcase video. Shows the poster with a play button, and only downloads the video when someone
 * presses play, so the landing page stays light.
 */
export function TallyVideo() {
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-black/20">
      {playing ? (
        <video
          ref={video}
          src={TALLY_VIDEO}
          poster={TALLY_POSTER}
          controls
          autoPlay
          playsInline
          preload="auto"
          aria-label="Meet Tally, the Leaf2Sale assistant"
          className="aspect-video w-full"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group relative block w-full focus-visible:outline-4 focus-visible:outline-brand-400" data-testid="tally-video-play">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={TALLY_POSTER} alt="Tally answering a question about quarantined packages in the Leaf2Sale assistant panel" className="aspect-video w-full object-cover" loading="lazy" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition group-hover:bg-black/25">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-brand-800 shadow-lg transition group-hover:scale-105">
              <Play className="ml-1 h-9 w-9" aria-hidden="true" fill="currentColor" />
            </span>
          </span>
          <span className="sr-only">Play the Tally video, 1 minute 16 seconds</span>
        </button>
      )}
    </div>
  );
}
