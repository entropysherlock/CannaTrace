"use client";

/** Short register beeps, like a real scanner: high for success, low for a problem. Silent if audio is unavailable. */
let ctx: AudioContext | null = null;
const MUTE_KEY = "ct-register-muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setMuted(muted: boolean): void {
  queueMicrotask(() => listeners.forEach((l) => l()));
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode); the setting just will not stick.
  }
}

export function beep(kind: "ok" | "error"): void {
  if (isMuted()) return;
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === "ok" ? "sine" : "square";
    osc.frequency.value = kind === "ok" ? 1760 : 220;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === "ok" ? 0.09 : 0.28));
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (kind === "ok" ? 0.1 : 0.3));
  } catch {
    // No audio on this device.
  }
}
