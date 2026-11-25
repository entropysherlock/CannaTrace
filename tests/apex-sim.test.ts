import fs from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "@/lib/db";
import { invariants, reconcile, runSim } from "./apex/sim";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const hasDb = Boolean(process.env.DATABASE_URL);
// With no settings this is a quick smoke run (it still reaches harvest, lab, transfer and wholesale); the workflow and the report runs set the full scale.
const days = Number(process.env.APEX_DAYS ?? 110);
const budgetMs = Number(process.env.APEX_BUDGET_MIN ?? 5) * 60_000;
const checkpoint = process.env.APEX_CHECKPOINT ?? `${tmpdir()}/apex-sim-${Date.now()}.ckpt`;

describe.skipIf(!hasDb)("Apex simulation (real logic, real database, reference ledger)", () => {
  afterAll(() => pool.end());
  it(`runs ${days} simulated days and reconciles to the ledger`, async () => {
    const out = await runSim({ seed: Number(process.env.APEX_SEED ?? 7), days, salesPerStoreDay: Number(process.env.APEX_SALES ?? 4), checkpoint, budgetMs, plantsPerBatch: Number(process.env.APEX_PLANTS ?? 20) });
    const w = out.state.world;
    console.log(`APEX day ${w.day}/${days} sales=${out.state.ledger.sales.size} findings=${w.findings.length} mismatches=${out.mismatches.length}`);
    const pct = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a.length ? Number(a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2)) : null; };
    const L = out.state.ledger;
    const timings = Object.fromEntries(Object.entries(w.timings).map(([k, v]) => [k, { n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), p99: pct(v, 0.99), max: pct(v, 1) }]));
    fs.writeFileSync(process.env.APEX_STATS ?? "/tmp/apex-run-stats.json", JSON.stringify({ day: w.day, days, seed: Number(process.env.APEX_SEED ?? 7), sales: L.sales.size, counters: L.counters, plants: L.plants, harvests: L.harvests.size, transfers: { count: L.transfers.count, out: L.transfers.outUnits.toString(), in: L.transfers.inUnits.toString() }, wholesaleCents: L.wholesaleCents.toString(), wholesalePaidCents: L.wholesalePaidCents.toString(), findings: w.findings, timingsMs: timings }, null, 2));
    const inv = out.finished ? await invariants(w) : [];
    const final = out.finished ? await reconcile(w, out.state.ledger) : [];
    if (out.finished) {
      const file = process.env.APEX_STATS ?? "/tmp/apex-run-stats.json";
      const prev = JSON.parse(fs.readFileSync(file, "utf8"));
      fs.writeFileSync(file, JSON.stringify({ ...prev, finished: true, finalReconciliationMismatches: final, invariantViolations: inv, ledger: { salesRecorded: L.sales.size, wholesaleCents: L.wholesaleCents.toString() } }, null, 2));
      expect(final).toEqual([]);
      expect(inv).toEqual([]);
    }
    expect(w.findings).toEqual([]);
    expect(out.mismatches).toEqual([]);
  }, 3_600_000);
});
