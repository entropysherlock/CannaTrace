import { describe, expect, it } from "vitest";
import { briefLines, renderBriefEmail } from "@/lib/morning-brief-email";

const quiet = {
  overview: { packages_in_stock: 10, packages_on_hold: 0, sales_today: 0, sales_today_total: "0" },
  sellable_lab_problems: { failed_lab_still_sellable: 0, active_without_passing_lab: 0 },
  state_reporting: { waiting: 0, failed: 0, enter_by_hand: 0, oldest_waiting_hours: null },
  money_owed: { unpaid_invoices: 0, total_owed: "0", overdue_invoices: 0, overdue_owed: "0" },
  needs_attention: [],
};

describe("morning brief email", () => {
  it("says all clear when nothing needs attention", () => {
    const mail = renderBriefEmail("Caleb", [{ facility: "Main", brief: quiet }], "Friday, November 27");
    expect(mail.subject).toBe("Morning brief: all clear");
    expect(mail.text).toContain("Nothing flagged by Tally Watch.");
    expect(mail.text).toContain("No unpaid invoices.");
  });

  it("counts findings, shows the problems, and escapes anything unsafe", () => {
    const busy = {
      ...quiet,
      sellable_lab_problems: { failed_lab_still_sellable: 2, active_without_passing_lab: 1 },
      state_reporting: { waiting: 3, failed: 1, enter_by_hand: 0, oldest_waiting_hours: 5 },
      money_owed: { unpaid_invoices: 2, total_owed: "600", overdue_invoices: 1, overdue_owed: "500" },
      needs_attention: [{ severity: "critical", problem: "Failed lab <b>sellable</b>", detail: "2 packages" }],
    };
    const mail = renderBriefEmail("Caleb", [{ facility: "Main & Co", brief: busy }], "Friday, November 27");
    expect(mail.subject).toBe("Morning brief: 1 thing needs a look");
    expect(mail.html).not.toContain("<b>sellable</b>");
    expect(mail.html).toContain("&lt;b&gt;sellable&lt;/b&gt;");
    expect(mail.html).toContain("Main &amp; Co");
    const { facts } = briefLines(busy);
    expect(facts.join(" ")).toContain("2 packages failed a lab test but can still be sold.");
    expect(facts.join(" ")).toContain("The oldest has waited 5 hours.");
    expect(facts.join(" ")).toContain("$600.00 owed. 1 overdue ($500.00).");
  });

  it("leaves out sections the person's permissions did not return", () => {
    const { facts } = briefLines({ overview: quiet.overview, needs_attention: [] });
    expect(facts.join(" ")).not.toContain("State reports");
    expect(facts.join(" ")).not.toContain("invoice");
  });
});
