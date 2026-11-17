import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { packFor, requiresLabBeforeRetail, rulesOf, stateLimits, type StatePack } from "./index";

export type Issue = {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  fix?: { label: string; href: string };
  ruleId?: string;
};

export type ScanResult = { pack: StatePack | null; state: string; licenseType: string; issues: Issue[]; score: number };

type Row = Record<string, unknown>;
const rows = async (query: ReturnType<typeof sql>) => (await db.execute<Row>(query)).rows;
const OZ = 28.3495;

/** Compliance score out of 100: each high issue costs 25 points and each medium one 10. */
export function scoreOf(issues: Issue[]): number {
  const cost = issues.reduce((sum, i) => sum + (i.severity === "high" ? 25 : i.severity === "medium" ? 10 : 0), 0);
  return Math.max(0, 100 - cost);
}

/** Everything at this facility that breaks, or is about to break, its state's rules. Read-only. */
export async function scanFacility(orgId: string, facilityId: string): Promise<ScanResult> {
  const [facility] = await rows(sql`select state, license_type from facilities where id = ${facilityId} and org_id = ${orgId}`);
  const state = String(facility?.state ?? "");
  const licenseType = String(facility?.license_type ?? "");
  const pack = packFor(state);
  const issues: Issue[] = [];

  if (!pack) {
    issues.push({
      id: "no-pack",
      severity: "info",
      title: `No rule pack for ${state || "this state"} yet`,
      detail:
        "CannaTrace still enforces your store's own limits and settings, and keeps every record, but it is not checking this state's specific rules. Review them with your regulator.",
    });
  }

  // State reporting failures
  const [sync] = await rows(sql`select count(*) filter (where status = 'FAILED')::int as failed, count(*) filter (where status = 'MANUAL')::int as manual
    from sync_events where org_id = ${orgId} and facility_id = ${facilityId}`);
  if (Number(sync?.failed) > 0)
    issues.push({
      id: "sync-failed",
      severity: "high",
      title: `${sync.failed} state report${Number(sync.failed) === 1 ? "" : "s"} failed`,
      detail: "These changes have not reached the state system. Fix and retry them so your records match.",
      fix: { label: "Open state reporting", href: "/compliance" },
    });
  if (Number(sync?.manual) > 0)
    issues.push({
      id: "sync-manual",
      severity: "medium",
      title: `${sync.manual} record${Number(sync.manual) === 1 ? "" : "s"} to enter in the state system by hand`,
      detail: "Your state system does not accept these automatically yet. Enter them there, then mark them entered.",
      fix: { label: "Open state reporting", href: "/compliance" },
    });

  // Store settings looser than the state's
  const [settings] = await rows(sql`select flower_limit_grams::text as flower, concentrate_limit_grams::text as concentrate, edible_limit_mg::text as edible, adult_min_age
    from retail_settings where facility_id = ${facilityId}`);
  if (pack && settings) {
    const caps = stateLimits(pack, "ADULT_USE");
    const looser: string[] = [];
    const show = (grams: Decimal, unit: string) => (unit === "g" && grams.gte(OZ) ? `${grams.div(OZ).toDecimalPlaces(2)} oz` : `${grams} ${unit}`);
    if (caps.FLOWER && new Decimal(String(settings.flower)).gt(caps.FLOWER)) looser.push(`flower ${show(new Decimal(String(settings.flower)), "g")} (state: ${show(caps.FLOWER, "g")})`);
    if (caps.CONCENTRATE && new Decimal(String(settings.concentrate)).gt(caps.CONCENTRATE)) looser.push(`concentrate ${settings.concentrate} g (state: ${caps.CONCENTRATE} g)`);
    if (caps.EDIBLE && new Decimal(String(settings.edible)).gt(caps.EDIBLE)) looser.push(`edibles ${settings.edible} mg (state: ${caps.EDIBLE} mg)`);
    if (looser.length)
      issues.push({
        id: "store-limits",
        severity: "medium",
        title: "Store purchase limits are higher than the state allows",
        detail: `Your store rules allow ${looser.join(", ")}. The register already applies the lower state limit, but update your store rules so receipts and staff training match.`,
        fix: { label: "Edit store rules", href: "/pos/menu" },
        ruleId: rulesOf(pack, "PURCHASE_LIMIT")[0]?.id,
      });
    const age = rulesOf(pack, "MIN_AGE").find((r) => r.customer === "ADULT_USE");
    if (age && Number(settings.adult_min_age) < age.years)
      issues.push({
        id: "store-age",
        severity: "medium",
        title: `Store minimum age is below ${age.years}`,
        detail: `Your store rules say ${settings.adult_min_age}. Check-in already uses the state's ${age.years}, but correct the store setting.`,
        fix: { label: "Edit store rules", href: "/pos/menu" },
        ruleId: age.id,
      });
  }

  // Menu products that cannot be sold without a passing test
  if (requiresLabBeforeRetail(pack)) {
    const untested = await rows(sql`select p.tag, i.name as item from packages p join items i on i.id = p.item_id
      join retail_prices rp on rp.item_id = p.item_id and rp.facility_id = p.facility_id
      where p.org_id = ${orgId} and p.facility_id = ${facilityId} and p.status = 'ACTIVE' and p.quantity > 0
        and coalesce((select lr.status::text from lab_results lr where lr.package_id = p.id order by lr.created_at desc limit 1), '') <> 'PASS'
      order by p.created_at limit 50`);
    if (untested.length)
      issues.push({
        id: "untested-menu",
        severity: "medium",
        title: `${untested.length}${untested.length === 50 ? "+" : ""} package${untested.length === 1 ? "" : "s"} on the menu without a passing lab result`,
        detail: `The register will not sell these until a passing result is entered: ${untested
          .slice(0, 5)
          .map((u) => `${u.tag} (${u.item})`)
          .join(", ")}${untested.length > 5 ? ", and more" : ""}.`,
        fix: { label: "Open inventory", href: `/inventory?q=${encodeURIComponent(String(untested[0].tag))}` },
        ruleId: rulesOf(pack, "LAB_TEST_BEFORE_RETAIL")[0]?.id,
      });
  }

  // A failed lab result on product that is still sellable
  const failedActive = await rows(sql`select p.tag from packages p where p.org_id = ${orgId} and p.facility_id = ${facilityId} and p.status in ('ACTIVE','ALLOCATED')
    and (select lr.status::text from lab_results lr where lr.package_id = p.id order by lr.created_at desc limit 1) = 'FAIL' limit 20`);
  if (failedActive.length)
    issues.push({
      id: "failed-lab-active",
      severity: "high",
      title: `${failedActive.length} package${failedActive.length === 1 ? "" : "s"} failed lab testing but ${failedActive.length === 1 ? "is" : "are"} active`,
      detail: `Quarantine or destroy: ${failedActive.map((f) => f.tag).join(", ")}.`,
      fix: { label: "Open inventory", href: `/inventory?q=${encodeURIComponent(String(failedActive[0].tag))}` },
    });

  // Physical inventory reconciliation
  for (const rule of rulesOf(pack, "RECONCILIATION")) {
    if (!rule.licenseTypes.includes(licenseType)) continue;
    const [last] = await rows(sql`select max(created_at) as at from cycle_counts where org_id = ${orgId} and facility_id = ${facilityId}`);
    const at = last?.at ? new Date(String(last.at)) : null;
    const days = at ? Math.floor((Date.now() - at.getTime()) / 86_400_000) : null;
    if (days === null || days > rule.everyDays)
      issues.push({
        id: "reconciliation",
        severity: "medium",
        title: days === null ? "No inventory count recorded yet" : `Last inventory count was ${days} days ago`,
        detail: `${pack!.name} requires a full inventory reconciliation at least monthly. Count every location and save the counts.`,
        fix: { label: "Start a count", href: "/counts" },
        ruleId: rule.id,
      });
  }

  // Waste waiting out its hold period
  const waste = rulesOf(pack, "WASTE")[0];
  if (waste) {
    const ready = await rows(sql`select tag from packages where org_id = ${orgId} and facility_id = ${facilityId} and status in ('ON_HOLD','QUARANTINE')
      and held_since < now() - make_interval(hours => ${waste.holdHours}) order by held_since limit 20`);
    if (ready.length)
      issues.push({
        id: "waste-ready",
        severity: "info",
        title: `${ready.length} held package${ready.length === 1 ? " has" : "s have"} passed the ${waste.holdHours}-hour hold`,
        detail: `If they are waste, they can now be mixed and destroyed: ${ready.map((r) => r.tag).join(", ")}. Report waste within ${waste.noticeBusinessDays ?? 5} business days.`,
        fix: { label: "Open inventory", href: `/inventory?q=${encodeURIComponent(String(ready[0].tag))}` },
        ruleId: waste.id,
      });
  }

  return { pack, state, licenseType, issues, score: scoreOf(issues) };
}
