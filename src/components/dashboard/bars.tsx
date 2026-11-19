type Point = { day: string; value: number };

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Group daily values by week when there are many days, so 90 bars become 13. */
export function bucket(points: Point[]): Point[] {
  if (points.length <= 31) return points;
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const week = points.slice(i, i + 7);
    out.push({ day: week[0].day, value: week.reduce((s, p) => s + p.value, 0) });
  }
  return out;
}

/** A simple bar chart drawn on the server, with a screen-reader table of the same numbers. */
export function Bars({ points, unit }: { points: Point[]; unit: string }) {
  const data = bucket(points);
  const max = Math.max(1, ...data.map((p) => p.value));
  const W = 320;
  const H = 150;
  const bw = W / data.length;
  const ticks = [0, Math.round(max / 2), max];
  return (
    <figure>
      <svg viewBox={`0 0 ${W + 34} ${H + 22}`} className="h-auto w-full" aria-hidden="true">
        {ticks.map((t) => {
          const y = H - (t / max) * (H - 6);
          return (
            <g key={t}>
              <line x1="34" x2={W + 34} y1={y} y2={y} stroke="#eef2ef" />
              <text x="30" y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
                {t >= 1000 ? `${Math.round(t / 100) / 10}k` : t}
              </text>
            </g>
          );
        })}
        {data.map((p, i) => {
          const h = (p.value / max) * (H - 6);
          return <rect key={p.day} x={34 + i * bw + bw * 0.18} y={H - h} width={bw * 0.64} height={Math.max(h, p.value ? 1 : 0)} rx="2" fill="#4caf6a" />;
        })}
        {/* First and last labels anchor to the chart's edges so they're never cut off. */}
        {[...new Set([0, Math.floor(data.length / 2), data.length - 1])].map((i) => {
          const edge = data.length > 1 && i === 0 ? "start" : data.length > 1 && i === data.length - 1 ? "end" : "middle";
          const x = edge === "start" ? 34 + i * bw : edge === "end" ? 34 + (i + 1) * bw : 34 + i * bw + bw / 2;
          return (
            <text key={i} x={x} y={H + 16} textAnchor={edge} className="fill-slate-500 text-[10px]">
              {short(data[i].day)}
            </text>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{unit}</caption>
        <tbody>
          {data.map((p) => (
            <tr key={p.day}>
              <th>{short(p.day)}</th>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
