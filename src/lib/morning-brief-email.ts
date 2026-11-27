import { SITE_URL } from "@/lib/site";

export type Brief = Record<string, unknown>;
type Obj = Record<string, unknown>;

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (v: unknown) => Number(v ?? 0) || 0;
const money = (v: unknown) => `$${num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The lines of one facility's brief, in plain words. Used for both the text and the HTML versions. */
export function briefLines(brief: Brief): { attention: { severity: string; text: string }[]; facts: string[] } {
  const facts: string[] = [];
  const o = (brief.overview ?? {}) as Obj;
  if (brief.overview) {
    facts.push(`${plural(num(o.packages_in_stock), "package")} in stock, ${num(o.packages_on_hold)} on hold or in quarantine.`);
    facts.push(`Sales today so far: ${plural(num(o.sales_today), "sale")}, ${money(o.sales_today_total)}.`);
  }
  const lab = brief.sellable_lab_problems as Obj | undefined;
  if (lab) {
    if (num(lab.failed_lab_still_sellable) > 0) facts.push(`${plural(num(lab.failed_lab_still_sellable), "package")} failed a lab test but can still be sold.`);
    if (num(lab.active_without_passing_lab) > 0) facts.push(`${plural(num(lab.active_without_passing_lab), "active package")} with no passing lab result.`);
  }
  const st = brief.state_reporting as Obj | undefined;
  if (st) {
    const age = st.oldest_waiting_hours == null ? "" : ` The oldest has waited ${plural(num(st.oldest_waiting_hours), "hour")}.`;
    facts.push(`State reports: ${num(st.waiting)} waiting, ${num(st.failed)} failed, ${num(st.enter_by_hand)} to enter by hand.${num(st.waiting) > 0 ? age : ""}`);
  }
  const owed = brief.money_owed as Obj | undefined;
  if (owed) {
    facts.push(
      num(owed.unpaid_invoices) === 0
        ? "No unpaid invoices."
        : `${plural(num(owed.unpaid_invoices), "unpaid invoice")}, ${money(owed.total_owed)} owed. ${num(owed.overdue_invoices)} overdue (${money(owed.overdue_owed)}).`,
    );
  }
  const attention = ((brief.needs_attention as Obj[] | undefined) ?? []).map((f) => ({ severity: String(f.severity ?? "info"), text: `${f.problem}${f.detail ? `: ${f.detail}` : ""}` }));
  return { attention, facts };
}

const COLORS: Record<string, string> = { critical: "#b91c1c", warning: "#b45309", info: "#475569" };

export function renderBriefEmail(name: string, sections: { facility: string; brief: Brief }[], dateLabel: string): { subject: string; html: string; text: string } {
  const parts = sections.map((s) => ({ facility: s.facility, ...briefLines(s.brief) }));
  const total = parts.reduce((n, p) => n + p.attention.length, 0);
  const subject = total > 0 ? `Morning brief: ${plural(total, "thing")} need${total === 1 ? "s" : ""} a look` : "Morning brief: all clear";
  const text = [
    `Good morning, ${name}. Here is your Leaf2Sale brief for ${dateLabel}.`,
    ...parts.flatMap((p) => [
      "",
      p.facility.toUpperCase(),
      ...(p.attention.length ? ["Needs attention:", ...p.attention.map((a) => ` - [${a.severity}] ${a.text}`)] : ["Nothing flagged by Tally Watch."]),
      ...p.facts.map((f) => ` * ${f}`),
    ]),
    "",
    `Open Leaf2Sale: ${SITE_URL}/dashboard`,
    `Turn this email off: ${SITE_URL}/account`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
<h2 style="margin:0 0 4px">Good morning, ${esc(name)}.</h2>
<p style="margin:0 0 16px;color:#475569">Your Leaf2Sale brief for ${esc(dateLabel)}.</p>
${parts
  .map(
    (p) => `<div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px">
<h3 style="margin:0 0 8px">${esc(p.facility)}</h3>
${
  p.attention.length
    ? `<p style="margin:0 0 4px;font-weight:600">Needs attention</p><ul style="margin:0 0 12px;padding-left:18px">${p.attention
        .map((a) => `<li style="margin:2px 0;color:${COLORS[a.severity] ?? COLORS.info}">${esc(a.text)}</li>`)
        .join("")}</ul>`
    : `<p style="margin:0 0 12px;color:#166534">Nothing flagged by Tally Watch.</p>`
}
<ul style="margin:0;padding-left:18px;color:#334155">${p.facts.map((f) => `<li style="margin:2px 0">${esc(f)}</li>`).join("")}</ul>
</div>`,
  )
  .join("")}
<p><a href="${SITE_URL}/dashboard" style="background:#15803d;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">Open Leaf2Sale</a></p>
<p style="font-size:12px;color:#64748b">You get this because you turned it on under Your account. <a href="${SITE_URL}/account">Turn it off</a>.</p>
</div>`;
  return { subject, html, text };
}

