import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Runs the real setup against a throwaway database, so it never touches the main test data.
const base = process.env.DATABASE_URL;
const hasDb = Boolean(base) && /localhost|127\.0\.0\.1/.test(base ?? "");
const name = `ct_setup_${Date.now().toString(36)}`;
const url = base?.replace(/\/[^/?]+(\?|$)/, `/${name}$1`) ?? "";
const run = (code: string) =>
  execSync(`npx tsx -e ${JSON.stringify(code)}`, {
    env: { ...process.env, DATABASE_URL: url, NODE_OPTIONS: "" },
    encoding: "utf8",
    cwd: process.cwd(),
  }).trim();
const psql = (db: string, q: string) => execSync(`psql "${base!.replace(/\/[^/?]+(\?|$)/, `/${db}$1`)}" -tAc ${JSON.stringify(q)}`, { encoding: "utf8" }).trim();

describe.skipIf(!hasDb)("first-run setup and demo removal (throwaway database)", () => {
  it("removes only a lone demo company, then lets exactly one real owner set up", { timeout: 120_000 }, () => {
    psql("postgres", `create database ${name}`);
    try {
      execSync("npx drizzle-kit migrate", { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
      const prelude = `import { pool } from "./src/lib/db"; import { removeDemoCompany } from "./scripts/remove-demo"; import { createFirstOwner, needsSetup } from "./src/lib/setup";`;

      // Empty database: nothing to remove, setup needed.
      expect(run(`${prelude} (async () => { console.log(await removeDemoCompany(), await needsSetup()); await pool.end(); })()`)).toMatch(/No businesses yet.*true/);

      // Load the demo, then remove it: everything is gone, including locked history.
      run(`import { pool } from "./src/lib/db"; import { seedDemo } from "./scripts/seed"; seedDemo("local-test-password").then(() => pool.end());`);
      expect(Number(psql(name, "select count(*) from audit_logs"))).toBeGreaterThan(0);
      expect(run(`${prelude} (async () => { console.log(await removeDemoCompany()); await pool.end(); })()`)).toMatch(/Removed the demo company/);
      for (const table of ["organizations", "users", "packages", "audit_logs", "inventory_transactions", "sync_events"]) {
        expect(psql(name, `select count(*) from ${table}`), table).toBe("0");
      }

      // Setup: validates, creates one owner, then refuses a second time.
      const good = `{ businessName: "Real Co", facilityName: "Main St", licenseNumber: "lic-1", licenseType: "RETAIL", state: "nm", ownerName: "Pat", email: "Pat@Example.com", password: "a-long-real-password" }`;
      expect(run(`${prelude} createFirstOwner({ ...${good}, password: "short" }).catch((e) => console.log(e.message)).finally(() => pool.end());`)).toMatch(/at least 12 characters/);
      expect(run(`${prelude} createFirstOwner({ ...${good}, state: "New Mexico" }).catch((e) => console.log(e.message)).finally(() => pool.end());`)).toMatch(/Choose one of the listed states/);
      run(`${prelude} createFirstOwner(${good}).then(() => pool.end());`);
      expect(psql(name, "select email || ' ' || role from users")).toBe("pat@example.com OWNER");
      expect(psql(name, "select license_number || ' ' || state from facilities")).toBe("LIC-1 NM");
      expect(run(`${prelude} createFirstOwner({ ...${good}, email: "x@example.com" }).catch((e) => console.log(e.message)).finally(() => pool.end());`)).toMatch(/already set up/);

      // With a real business present, demo removal never runs, even if a demo company appears.
      run(`import { pool } from "./src/lib/db"; import { seedDemo } from "./scripts/seed"; seedDemo("local-test-password").then(() => pool.end());`);
      expect(run(`${prelude} (async () => { console.log(await removeDemoCompany()); await pool.end(); })()`)).toMatch(/alongside a real business/);
      expect(psql(name, "select count(*) from organizations")).toBe("2");
    } finally {
      psql("postgres", `drop database if exists ${name} with (force)`);
    }
  });
});
