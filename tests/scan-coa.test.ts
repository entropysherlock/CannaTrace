import { describe, expect, it } from "vitest";
import { cleanPercent, proposeCoa } from "@/lib/scan/coa-math";
import type { CoaProposal } from "@/lib/scan/types";

const TODAY = "2026-11-20";
const base = { document_type: "COA", lab_name: "Sandia Analytical", sample_date: "2026-11-02", overall_result: "PASS", thc_total_percent: 24.13, thca_percent: 27.1, d9_thc_percent: 0.36, cbd_total_percent: 0.05, product_name: "Desert Haze" };
const coa = (raw: Record<string, unknown>) => proposeCoa(raw, TODAY) as CoaProposal;

describe("cleaning percents", () => {
  it("accepts plain numbers and printed percents, and rejects anything else", () => {
    expect(cleanPercent(24.1)).toBe("24.1");
    expect(cleanPercent("24.1 %")).toBe("24.1");
    expect(cleanPercent("24,1")).toBe("24.1");
    expect(cleanPercent("0.0504")).toBe("0.05");
    expect(cleanPercent("ND")).toBeNull();
    expect(cleanPercent("<LOQ")).toBeNull();
    expect(cleanPercent(104)).toBeNull();
    expect(cleanPercent(null)).toBeNull();
  });
});

describe("turning a read certificate into a proposal", () => {
  it("fills the form and marks what was sure, unsure, and missing", () => {
    const p = coa({ ...base, cbg_percent: 0.8, uncertain_fields: ["cbg_percent"] });
    expect(p.kind).toBe("COA");
    expect(p.values).toMatchObject({ labName: "Sandia Analytical", sampleDate: "2026-11-02", result: "PASS", thcPercent: "24.13", cbdPercent: "0.05", cbgPercent: "0.8" });
    expect(p.confidence.labName).toBe("ok");
    expect(p.confidence.cbgPercent).toBe("check");
    expect(p.confidence.cbnPercent).toBe("missing");
    expect(p.identifiers.product).toBe("Desert Haze");
    expect(p.warnings).toEqual([]);
  });

  it("flags total THC that doesn't match THCa x 0.877 + delta-9", () => {
    const p = coa({ ...base, thc_total_percent: 31.4 });
    expect(p.confidence.thcPercent).toBe("check");
    expect(p.warnings.join(" ")).toMatch(/doesn't match THCa × 0\.877/);
  });

  it("works out total THC when the certificate only gives the parts, and says so", () => {
    const p = coa({ ...base, thc_total_percent: null });
    expect(p.values.thcPercent).toBe("24.127");
    expect(p.confidence.thcPercent).toBe("check");
    expect(p.warnings.join(" ")).toMatch(/worked out/);
  });

  it("never invents a result: an unclear pass or fail is left for the person", () => {
    const p = coa({ ...base, overall_result: "UNKNOWN" });
    expect(p.values.result).toBe("");
    expect(p.confidence.result).toBe("missing");
    expect(p.warnings.join(" ")).toMatch(/pass or fail/);
  });

  it("catches a sample date in the future, a bad date, and bad percentages", () => {
    expect(coa({ ...base, sample_date: "2026-12-30" }).warnings.join(" ")).toMatch(/in the future/);
    expect(coa({ ...base, sample_date: "11/02/2026" }).values.sampleDate).toBe("");
    const p = coa({ ...base, cbn_percent: "ND", cbg_percent: 250 });
    expect(p.values.cbnPercent).toBe("");
    expect(p.values.cbgPercent).toBe("");
    expect(p.warnings.join(" ")).toMatch(/cbg percent/);
  });

  it("flags total cannabinoids below total THC", () => {
    const p = coa({ ...base, total_cannabinoids_percent: 12 });
    expect(p.confidence.totalCannabinoidsPercent).toBe("check");
  });

  it("says plainly when the document isn't a certificate", () => {
    expect(proposeCoa({ document_type: "OTHER", notes: "A store receipt." }, TODAY)).toEqual({ kind: "OTHER", summary: "A store receipt." });
    expect(proposeCoa({}, TODAY).kind).toBe("OTHER");
  });
});
