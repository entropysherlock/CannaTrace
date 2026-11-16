/** CannaTrace mark: an original seven-point leaf, drawn in code. */
export function LeafMark({ className = "h-7 w-7" }: { className?: string }) {
  const leaflets = [
    { angle: 0, length: 44 },
    { angle: -28, length: 38 },
    { angle: 28, length: 38 },
    { angle: -58, length: 30 },
    { angle: 58, length: 30 },
    { angle: -86, length: 20 },
    { angle: 86, length: 20 },
  ];
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <g transform="translate(50 62)" fill="currentColor">
        {leaflets.map(({ angle, length }) => (
          <path
            key={angle}
            transform={`rotate(${angle})`}
            d={`M0 0 C ${length * 0.18} ${-length * 0.35}, ${length * 0.12} ${-length * 0.8}, 0 ${-length} C ${-length * 0.12} ${-length * 0.8}, ${-length * 0.18} ${-length * 0.35}, 0 0 Z`}
          />
        ))}
        <rect x="-1.6" y="0" width="3.2" height="26" rx="1.6" />
      </g>
    </svg>
  );
}

export function Logo({ tone = "dark", size = "md" }: { tone?: "dark" | "light"; size?: "md" | "lg" }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${size === "lg" ? "text-2xl" : "text-lg"}`}>
      <LeafMark className={`${size === "lg" ? "h-9 w-9" : "h-7 w-7"} ${tone === "dark" ? "text-brand-700" : "text-brand-200"}`} />
      <span className={tone === "dark" ? "text-slate-900" : "text-white"}>CannaTrace</span>
    </span>
  );
}
