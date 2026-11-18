/** A ring chart of parts of a whole, with the total in the middle. Drawn on the server; the legend beside it carries every value. */
export function Donut({ parts, total, label }: { parts: { key: string; value: number; color: string }[]; total: number; label: string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`${total.toLocaleString("en-US")} ${label}`}>
      <circle cx="70" cy="70" r={R} fill="none" stroke="#e8efe9" strokeWidth="18" />
      {total > 0
        ? parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const len = (p.value / total) * C;
              const el = (
                <circle
                  key={p.key}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="18"
                  strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 70 70)"
                />
              );
              offset += len;
              return el;
            })
        : null}
      <text x="70" y="68" textAnchor="middle" className="fill-slate-900 text-[20px] font-extrabold">
        {total.toLocaleString("en-US")}
      </text>
      <text x="70" y="86" textAnchor="middle" className="fill-slate-500 text-[11px] font-semibold">
        {label}
      </text>
    </svg>
  );
}
