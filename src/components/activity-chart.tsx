"use client";

import { useRef, useState } from "react";

type Point = { day: string; value: number };

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
}

const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One series over time: an area with a 2px line, a crosshair that snaps to the nearest day,
 * and a tooltip. Every value is also in the table below the chart for keyboard and screen readers.
 */
export function ActivityChart({ points, format, seriesLabel }: { points: Point[]; format: "money" | "count"; seriesLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fmt = (v: number) =>
    format === "money" ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : v.toLocaleString("en-US");

  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const labelEvery = Math.ceil(points.length / 5);

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const h = hover === null ? null : points[hover];
  return (
    <div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={`${seriesLabel} by day. Values are listed in the table below.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="activity-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2f8a4c" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#2f8a4c" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
                {fmt(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text key={p.day} x={x(i)} y={H - 8} textAnchor={i === points.length - 1 ? "end" : i === 0 ? "start" : "middle"} className="fill-slate-500 text-[11px]">
                {shortDay(p.day)}
              </text>
            ) : null,
          )}
          <path d={area} fill="url(#activity-fill)" />
          <path d={line} fill="none" stroke="#237a3e" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {h && hover !== null ? (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} stroke="#64748b" strokeWidth="1" />
              <circle cx={x(hover)} cy={y(h.value)} r="5" fill="#237a3e" stroke="white" strokeWidth="2" />
            </g>
          ) : null}
        </svg>
        {h && hover !== null ? (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})` }}
          >
            <p className="font-semibold text-slate-900">{fmt(h.value)}</p>
            <p className="flex items-center gap-1.5 text-slate-500">
              <span className="inline-block h-0.5 w-3 rounded bg-brand-600" />
              {seriesLabel}, {shortDay(h.day)}
            </p>
          </div>
        ) : null}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-700">Show as a table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">{seriesLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points
              .filter((p) => p.value > 0)
              .map((p) => (
                <tr key={p.day} className="border-b border-slate-100">
                  <td className="py-1">{shortDay(p.day)}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(p.value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
