import Image from "next/image";

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

/** The CannaTrace logo (public/brand/cannatrace-logo.png, 960×205). Its "Trace" is black, so on dark
 * backgrounds (tone "light") it sits on a white badge to stay readable. */
export function Logo({ tone = "dark", size = "md" }: { tone?: "dark" | "light"; size?: "md" | "lg" }) {
  const height = size === "lg" ? 40 : tone === "light" ? 26 : 30;
  const img = (
    <Image
      src="/brand/cannatrace-logo.png"
      alt="CannaTrace"
      width={Math.round((height * 960) / 205)}
      height={height}
      priority
      className="block h-auto max-w-full"
      style={{ height, width: "auto" }}
    />
  );
  return tone === "light" ? <span className="inline-flex rounded-lg bg-white px-2.5 py-1.5 shadow-sm">{img}</span> : <span className="inline-flex">{img}</span>;
}
