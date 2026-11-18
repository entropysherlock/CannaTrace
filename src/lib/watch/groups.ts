/**
 * Tally Watch grouping: every alert belongs to the check that raised it (its root cause).
 * Alerts are grouped by root cause and severity, most urgent and largest groups first.
 * Pure functions, shared by the Command Center card and the Tally Watch page.
 */

export type Severity = "critical" | "warning" | "info";

/** Each check, named as the problem behind it, with what usually fixes it. */
export const CAUSES: Record<string, { label: string; fix: string }> = {
  lab_fail: { label: "Failed lab test but still sellable", fix: "Put these packages on hold or record a passing retest." },
  unlabeled: { label: "New packages without labels", fix: "Print labels in SmartLabel AI." },
  license: { label: "Orders shipping to an expiring license", fix: "Confirm the buyer's license before the order ships." },
  harvest_open: { label: "Harvests left open", fix: "Record dry weight and finish the harvest." },
  run_open: { label: "Production runs left open", fix: "Finish or cancel the run." },
  overdue: { label: "Overdue balances with orders about to ship", fix: "Collect payment or hold the orders." },
  sync_failed: { label: "State reports that failed to send", fix: "Retry them from Compliance." },
  sync_manual: { label: "State reports to enter by hand", fix: "Enter them in the state system, then mark them done." },
  rule: { label: "State rule issues", fix: "Open each one in Compliance to fix it." },
  state_report_old: { label: "State package report is out of date", fix: "Upload a fresh export from the state system." },
  state_missing: { label: "In stock here, missing or closed in the state system", fix: "Report these packages to the state, or correct them here." },
  state_open: { label: "Closed here, still open in the state system", fix: "Finish or adjust them in the state system." },
  state_qty: { label: "Quantities that differ from the state system", fix: "Count the package, then adjust whichever side is wrong." },
  state_only: { label: "Open in the state system, not in CannaTrace", fix: "Import or receive these packages here." },
  state_many: { label: "More state differences than shown", fix: "Work through the list above, then check again." },
};

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Urgent", warning: "Soon", info: "FYI" };

export const causeOf = (check: string) => CAUSES[check] ?? { label: "Other things to look at", fix: "Open each one to see what to do." };

/** The anchor on the Tally Watch page for one group. */
export const groupKey = (check: string, severity: string) => `${check}-${severity}`.replace(/[^a-z0-9-]/gi, "-");

export type WatchGroup<T> = { key: string; check: string; severity: Severity; label: string; fix: string; count: number; items: T[] };

/** Group alerts by root cause and severity. Every alert lands in exactly one group, in its original order. */
export function groupFindings<T extends { check: string; severity: string }>(findings: T[]): WatchGroup<T>[] {
  const groups = new Map<string, WatchGroup<T>>();
  for (const f of findings) {
    const severity = (f.severity in SEVERITY_RANK ? f.severity : "info") as Severity;
    const key = groupKey(f.check, severity);
    let g = groups.get(key);
    if (!g) {
      const cause = causeOf(f.check);
      g = { key, check: f.check, severity, label: cause.label, fix: cause.fix, count: 0, items: [] };
      groups.set(key, g);
    }
    g.items.push(f);
    g.count++;
  }
  return [...groups.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count || a.label.localeCompare(b.label));
}
