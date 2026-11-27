import Decimal from "decimal.js";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { rewardLedger, rewardMembers, rewardSettings, type sales } from "@/db/schema";
import { db, type Tx } from "./db";
import { InventoryError, audit, type Actor } from "./inventory";
import { CONSENT_WORDING, earnSpeedFor, ensureCodes, findByReferralCode, getMarketingSettings, recordConsent } from "./loyalty-earn";
import { normalizeCode, normalizeEmail, pointsAtSpeed } from "./loyalty-math";
import {
  DEFAULT_PROGRAM,
  cleanProgram,
  isBirthdayMonth,
  normalizePhone,
  parseBirthday,
  pointsExpired,
  pointsToTakeBack,
  type RewardProgram,
} from "./rewards-math";

/**
 * The rewards (loyalty) program: settings, shoppers, and their points. Points live in a ledger (every earn, spend,
 * bonus, expiry and correction is a row) with a running balance on the shopper, locked whenever it changes.
 * The register pieces that need a cart (attach a shopper, use rewards) are in pos.ts; this file holds what
 * happens to points when a sale is paid, voided or returned, and the management screens.
 */

type Sale = typeof sales.$inferSelect;
type Reader = Tx | typeof db;
export type Member = typeof rewardMembers.$inferSelect;

export async function getProgram(reader: Reader, orgId: string): Promise<RewardProgram & { saved: boolean }> {
  const [row] = await reader.select().from(rewardSettings).where(eq(rewardSettings.orgId, orgId));
  if (!row) return { ...DEFAULT_PROGRAM, saved: false };
  return {
    enabled: row.enabled,
    pointsPerDollar: row.pointsPerDollar,
    redeemPoints: row.redeemPoints,
    redeemDollars: new Decimal(row.redeemDollars).toFixed(2),
    signupBonus: row.signupBonus,
    birthdayBonus: row.birthdayBonus,
    expireMonths: row.expireMonths,
    maxSharePercent: row.maxSharePercent,
    idLookup: row.idLookup,
    saved: true,
  };
}

export async function saveProgram(actor: Actor, input: Record<string, unknown>): Promise<RewardProgram> {
  const program = cleanProgram(input, (message) => {
    throw new InventoryError(message);
  });
  await db.transaction(async (tx) => {
    const before = await getProgram(tx, actor.orgId);
    await tx
      .insert(rewardSettings)
      .values({ orgId: actor.orgId, ...program, updatedAt: new Date() })
      .onConflictDoUpdate({ target: rewardSettings.orgId, set: { ...program, updatedAt: new Date() } });
    await audit(tx, actor, { entityType: "RewardsProgram", entityId: actor.orgId, action: "SETTINGS", before, after: program });
  });
  return program;
}

/** Add a ledger row and move the shopper's balance by the same amount. The caller holds the shopper's row lock. */
async function post(tx: Tx, actor: Actor, member: Member, entry: { kind: string; points: number; saleId?: string; note?: string }): Promise<Member> {
  if (entry.points === 0) return member;
  await tx.insert(rewardLedger).values({
    orgId: member.orgId,
    memberId: member.id,
    kind: entry.kind,
    points: entry.points,
    saleId: entry.saleId ?? null,
    note: entry.note ?? null,
    userName: actor.userName,
  });
  const [updated] = await tx
    .update(rewardMembers)
    .set({ points: sql`${rewardMembers.points} + ${entry.points}` })
    .where(eq(rewardMembers.id, member.id))
    .returning();
  return updated;
}

export async function lockMember(tx: Tx, orgId: string, memberId: string): Promise<Member> {
  const [member] = await tx
    .select()
    .from(rewardMembers)
    .where(and(eq(rewardMembers.id, memberId), eq(rewardMembers.orgId, orgId)))
    .for("update");
  if (!member) throw new InventoryError("That rewards member was not found. They may have been removed.");
  return member;
}

/** Points run out after the program's months with no purchase. Checked whenever a shopper is looked up or buys. */
export async function expireIfIdle(tx: Tx, actor: Actor, member: Member, program: RewardProgram): Promise<Member> {
  if (member.points <= 0 || !pointsExpired(member.lastActivityAt, new Date(), program.expireMonths)) return member;
  return post(tx, actor, member, { kind: "EXPIRE", points: -member.points, note: `No purchases for ${program.expireMonths} months` });
}

export async function findMemberByPhone(reader: Reader, orgId: string, phone: string): Promise<Member | null> {
  const [member] = await reader.select().from(rewardMembers).where(and(eq(rewardMembers.orgId, orgId), eq(rewardMembers.phone, phone)));
  return member ?? null;
}

/** The shopper whose ID fingerprint this is (see customerKeyFor), if they agreed to be recognized by it. */
export async function findMemberByIdKey(reader: Reader, orgId: string, idKey: string): Promise<Member | null> {
  const [member] = await reader.select().from(rewardMembers).where(and(eq(rewardMembers.orgId, orgId), eq(rewardMembers.idKey, idKey)));
  return member ?? null;
}

/** Sign a shopper up. Asked at the counter, with their agreement; gets the sign-up bonus. */
export async function createMember(
  tx: Tx,
  actor: Actor,
  program: RewardProgram,
  input: { phone: unknown; firstName: unknown; birthday?: unknown; agreed: unknown; email?: unknown; emailOk?: unknown; smsOk?: unknown; referralCode?: unknown },
  idKey?: string | null,
): Promise<Member> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new InventoryError("Type a 10-digit phone number, for example 505 555 0142.");
  const firstName = String(input.firstName ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!firstName) throw new InventoryError("Type the shopper's first name.");
  const birthday = parseBirthday(input.birthday);
  if (birthday === null) throw new InventoryError("Type the birthday as month and day, for example 3/14. Or leave it blank.");
  if (!(input.agreed === true || input.agreed === "on" || input.agreed === "true"))
    throw new InventoryError("Ask the shopper if they want to join, then tick the box to say they agreed.");
  if (await findMemberByPhone(tx, actor.orgId, phone)) throw new InventoryError("That phone number is already in the rewards program. Look it up instead.");
  const email = normalizeEmail(input.email);
  if (email === null) throw new InventoryError("That email doesn't look right. Check it or leave it blank.");
  const flag = (v: unknown) => v === true || v === "on" || v === "true";
  if (flag(input.emailOk) && !email) throw new InventoryError("Type the shopper's email, or untick the email box.");
  const code = normalizeCode(input.referralCode);
  const referrer = code ? await findByReferralCode(tx, actor.orgId, code) : null;
  if (code && !referrer) throw new InventoryError("That referral code isn't a member's code. Check it or leave it blank.");
  const [member] = await tx
    .insert(rewardMembers)
    .values({ orgId: actor.orgId, phone, firstName, birthday: birthday === "none" ? null : birthday, idKey: idKey ?? null, joinedBy: actor.userName, email: email || null, referredById: referrer?.id ?? null })
    .returning();
  await ensureCodes(tx, member);
  if (flag(input.emailOk)) await recordConsent(tx, actor, { memberId: member.id, channel: "EMAIL", status: "OPTED_IN", method: "REGISTER", wording: CONSENT_WORDING.EMAIL });
  if (flag(input.smsOk)) await recordConsent(tx, actor, { memberId: member.id, channel: "SMS", status: "OPTED_IN", method: "REGISTER", wording: CONSENT_WORDING.SMS });
  // No name or phone in the audit trail: it outlives the shopper if they later ask to be removed.
  await audit(tx, actor, {
    entityType: "RewardsMember",
    entityId: member.id,
    action: "JOIN",
    after: { birthday: Boolean(member.birthday), agreed: true, idLinked: Boolean(idKey), email: Boolean(email), emailOk: flag(input.emailOk), smsOk: flag(input.smsOk), referred: Boolean(referrer) },
  });
  return post(tx, actor, member, { kind: "SIGNUP", points: program.signupBonus });
}

/**
 * Settle a paid sale's rewards: spend the rewards used, earn points on what was paid before tax, and add the
 * birthday bonus once a year in the shopper's birthday month. Called inside completeSale's transaction.
 */
export async function settleSaleRewards(
  tx: Tx,
  actor: Actor,
  sale: Sale,
  input: { applied: number; rewardDollars: Decimal; paidBeforeTax: Decimal; today: string },
): Promise<{ earned: number; birthday: number; balance: number } | null> {
  if (!sale.rewardMemberId) return null;
  const program = await getProgram(tx, actor.orgId);
  if (!program.enabled) return null;
  let member = await lockMember(tx, actor.orgId, sale.rewardMemberId);
  member = await expireIfIdle(tx, actor, member, program);
  const spend = input.applied * program.redeemPoints;
  if (spend > member.points)
    throw new InventoryError(`${member.firstName} only has ${member.points} points now, not enough for ${input.applied} reward${input.applied === 1 ? "" : "s"}. Use fewer rewards and try again.`);
  if (spend > 0) member = await post(tx, actor, member, { kind: "REDEEM", points: -spend, saleId: sale.id, note: `Sale ${sale.number}: $${input.rewardDollars.toFixed(2)} off` });
  const speed = await earnSpeedFor(tx, actor.orgId, member.id, input.today);
  const earned = pointsAtSpeed(input.paidBeforeTax, program.pointsPerDollar, speed.percent);
  const [priorEarn] = await tx.select({ id: rewardLedger.id }).from(rewardLedger).where(and(eq(rewardLedger.memberId, member.id), eq(rewardLedger.kind, "EARN"))).limit(1);
  const speedNote = speed.percent === 100 ? "" : ` (${speed.percent}% speed${speed.tier ? `, ${speed.tier.name}` : ""}${speed.boost > 100 ? ", bonus days" : ""})`;
  member = await post(tx, actor, member, { kind: "EARN", points: earned, saleId: sale.id, note: `Sale ${sale.number}${speedNote}` });
  // A referral pays the referrer once, on the new shopper's first purchase.
  if (!priorEarn && member.referredById) {
    const bonus = (await getMarketingSettings(tx, actor.orgId)).referralBonus;
    if (bonus > 0) {
      const referrer = await lockMember(tx, actor.orgId, member.referredById).catch(() => null);
      if (referrer) await post(tx, actor, referrer, { kind: "REFERRAL", points: bonus, saleId: sale.id, note: `${member.firstName} made their first purchase with your referral code` });
    }
  }
  let birthday = 0;
  if (program.birthdayBonus > 0 && isBirthdayMonth(member.birthday, input.today)) {
    const year = input.today.slice(0, 4);
    const [already] = await tx
      .select({ id: rewardLedger.id })
      .from(rewardLedger)
      .where(and(eq(rewardLedger.memberId, member.id), eq(rewardLedger.kind, "BIRTHDAY"), sql`extract(year from ${rewardLedger.createdAt})::text = ${year}`))
      .limit(1);
    if (!already) {
      birthday = program.birthdayBonus;
      member = await post(tx, actor, member, { kind: "BIRTHDAY", points: birthday, saleId: sale.id, note: `Birthday month ${year}` });
    }
  }
  await tx.update(rewardMembers).set({ lastActivityAt: new Date() }).where(eq(rewardMembers.id, member.id));
  return { earned, birthday, balance: member.points };
}

/** A voided sale: give back the points spent and take back the points earned (never below zero). */
export async function reverseSaleRewards(tx: Tx, actor: Actor, sale: Sale): Promise<void> {
  if (!sale.rewardMemberId || (sale.pointsEarned === 0 && sale.rewardsUsed === 0)) return;
  let member = await lockMember(tx, actor.orgId, sale.rewardMemberId).catch(() => null);
  if (!member) return;
  const spent = await sumFor(tx, sale.id, "REDEEM");
  if (spent < 0) member = await post(tx, actor, member, { kind: "VOID", points: -spent, saleId: sale.id, note: `Sale ${sale.number} voided: points spent given back` });
  const takeBack = Math.min(sale.pointsEarned, Math.max(member.points, 0));
  await post(tx, actor, member, { kind: "VOID", points: -takeBack, saleId: sale.id, note: `Sale ${sale.number} voided: points earned taken back` });
}

/** A return: take back the points the refunded part earned. Points spent on the sale stay spent, like the industry norm. */
export async function takeBackForReturn(tx: Tx, actor: Actor, sale: Sale, refund: Decimal, finalReturn: boolean, returnNumber: string): Promise<void> {
  if (!sale.rewardMemberId || sale.pointsEarned <= 0) return;
  let member: Member;
  try {
    member = await lockMember(tx, actor.orgId, sale.rewardMemberId);
  } catch {
    return;
  }
  const already = -(await sumFor(tx, sale.id, "RETURN"));
  const want = pointsToTakeBack(sale.pointsEarned, already, refund, sale.total ?? 0, finalReturn);
  const take = Math.min(want, Math.max(member.points, 0));
  await post(tx, actor, member, { kind: "RETURN", points: -take, saleId: sale.id, note: `Return ${returnNumber} from sale ${sale.number}` });
}

async function sumFor(tx: Tx, saleId: string, kind: string): Promise<number> {
  const [{ total }] = await tx
    .select({ total: sql<number>`coalesce(sum(${rewardLedger.points}), 0)::int` })
    .from(rewardLedger)
    .where(and(eq(rewardLedger.saleId, saleId), eq(rewardLedger.kind, kind)));
  return Number(total);
}

// ---------- Management (managers) ----------

export async function listMembers(orgId: string, query: string, limit = 50) {
  const q = query.trim();
  const digits = q.replace(/\D/g, "");
  const where = q
    ? and(eq(rewardMembers.orgId, orgId), or(ilike(rewardMembers.firstName, `%${q}%`), digits.length >= 3 ? sql`${rewardMembers.phone} like ${`%${digits}%`}` : undefined))
    : eq(rewardMembers.orgId, orgId);
  return db.select().from(rewardMembers).where(where).orderBy(desc(rewardMembers.lastActivityAt)).limit(limit);
}

export async function programStats(orgId: string) {
  const [row] = await db
    .select({ members: sql<number>`count(*)::int`, points: sql<number>`coalesce(sum(${rewardMembers.points}), 0)::int` })
    .from(rewardMembers)
    .where(eq(rewardMembers.orgId, orgId));
  return { members: Number(row?.members ?? 0), points: Number(row?.points ?? 0) };
}

export async function memberHistory(orgId: string, memberId: string, limit = 100) {
  return db
    .select()
    .from(rewardLedger)
    .where(and(eq(rewardLedger.orgId, orgId), eq(rewardLedger.memberId, memberId)))
    .orderBy(desc(rewardLedger.createdAt))
    .limit(limit);
}

/** A manager's correction, with a reason. Can't take a shopper below zero. */
export async function adjustPoints(actor: Actor, input: { memberId: string; points: unknown; reason: unknown }): Promise<Member> {
  const raw = String(input.points ?? "").trim().replace(/^\+/, "");
  if (!/^-?\d+$/.test(raw) || Number(raw) === 0) throw new InventoryError("Type the points to add, like 50, or to take away, like -50.");
  const points = Number(raw);
  if (Math.abs(points) > 100000) throw new InventoryError("That's more points than a single correction allows.");
  const reason = String(input.reason ?? "").trim().slice(0, 200);
  if (!reason) throw new InventoryError("Say why. It goes in the shopper's points history and the audit trail.");
  return db.transaction(async (tx) => {
    const member = await lockMember(tx, actor.orgId, input.memberId);
    if (member.points + points < 0) throw new InventoryError(`${member.firstName} has ${member.points} points, so you can take away at most ${member.points}.`);
    const updated = await post(tx, actor, member, { kind: "ADJUST", points, note: reason });
    await audit(tx, actor, { entityType: "RewardsMember", entityId: member.id, action: "ADJUST_POINTS", before: { points: member.points }, after: { points: updated.points }, reason });
    return updated;
  });
}

/** Correct a shopper's name, phone or birthday. */
export async function updateMember(actor: Actor, input: { memberId: string; phone: unknown; firstName: unknown; birthday: unknown }): Promise<Member> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new InventoryError("Type a 10-digit phone number, for example 505 555 0142.");
  const firstName = String(input.firstName ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!firstName) throw new InventoryError("Type the shopper's first name.");
  const birthday = parseBirthday(input.birthday);
  if (birthday === null) throw new InventoryError("Type the birthday as month and day, for example 3/14. Or leave it blank.");
  return db.transaction(async (tx) => {
    const member = await lockMember(tx, actor.orgId, input.memberId);
    const other = await findMemberByPhone(tx, actor.orgId, phone);
    if (other && other.id !== member.id) throw new InventoryError("Another shopper already has that phone number.");
    const [updated] = await tx
      .update(rewardMembers)
      .set({ phone, firstName, birthday: birthday === "none" ? null : birthday })
      .where(eq(rewardMembers.id, member.id))
      .returning();
    await audit(tx, actor, {
      entityType: "RewardsMember",
      entityId: member.id,
      action: "UPDATE",
      after: { changed: [member.firstName !== firstName && "name", member.phone !== phone && "phone", (member.birthday ?? "none") !== birthday && "birthday"].filter(Boolean) },
    });
    return updated;
  });
}

/**
 * Remove a shopper who asks to leave: their name, phone, birthday and points history are deleted. Sales stay
 * (they're compliance records) but no longer point to the shopper.
 */
export async function deleteMember(actor: Actor, input: { memberId: string }): Promise<string> {
  return db.transaction(async (tx) => {
    const member = await lockMember(tx, actor.orgId, input.memberId);
    await tx.delete(rewardMembers).where(eq(rewardMembers.id, member.id));
    await audit(tx, actor, { entityType: "RewardsMember", entityId: member.id, action: "DELETE", before: { points: member.points } });
    return member.firstName;
  });
}
