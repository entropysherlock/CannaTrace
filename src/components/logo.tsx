import Image from "next/image";
import { BRAND } from "@/lib/brand";

/** Leaf2Sale mark: an original seven-point leaf, drawn in code. */
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

/** The Leaf2Sale logo (public/brand). tone "light" is for dark backgrounds and uses the white-text version. */
export function Logo({ tone = "dark", size = "md" }: { tone?: "dark" | "light"; size?: "md" | "lg" }) {
  const height = size === "lg" ? 40 : tone === "light" ? 26 : 30;
  const art = tone === "light" ? BRAND.logoDark : BRAND.logo;
  return (
    <span className="inline-flex">
      <Image
        src={art.src}
        alt={BRAND.name}
        width={Math.round((height * art.width) / art.height)}
        height={height}
        priority
        className="block h-auto max-w-full"
        style={{ height, width: "auto" }}
      />
    </span>
  );
}
