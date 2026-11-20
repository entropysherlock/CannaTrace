import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { aiConnections, aiUsage, auditLogs } from "@/db/schema";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { costUsd } from "./pricing";
import { encryptionReady, keyHint, needsReseal, openSecret, sealSecret } from "./secret-box";

/**
 * Tally's Claude connection. Each business connects its own Anthropic account; everyone in the business
 * shares it, and Tally's requests for that business are billed to it. CannaTrace's own key is only used
 * for the public live demo and for accounts CannaTrace explicitly lists (TALLY_PLATFORM_ORGS), or locally
 * when a developer opts in, so CannaTrace never quietly pays for a customer.
 */

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
export const CONSOLE_LINKS = {
  home: "https://platform.claude.com/",
  billing: "https://platform.claude.com/settings/billing",
  keys: "https://platform.claude.com/settings/keys",
  usage: "https://platform.claude.com/settings/usage",
  limits: "https://platform.claude.com/settings/limits",
};

export type ProblemKind = "INVALID_KEY" | "NO_CREDIT" | "RATE_LIMITED" | "ERROR";
export class ProviderError extends Error {
  constructor(
    public kind: ProblemKind,
    message: string,
  ) {
    super(message);
  }
}

/** Turn whatever Anthropic (or the network) said into a kind and a message a store manager can act on. */
export function explainProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const e = error as { status?: number; message?: string; error?: { error?: { type?: string; message?: string } } };
  const type = e?.error?.error?.type ?? "";
  const text = `${e?.error?.error?.message ?? ""} ${e?.message ?? ""}`;
  if (e?.status === 401 || type === "authentication_error")
    return new ProviderError("INVALID_KEY", "Anthropic didn't accept this API key. It may have been deleted, expired, or copied incompletely. Create a new key in the Claude Console and connect it here.");
  if (e?.status === 403 || type === "permission_error")
    return new ProviderError("INVALID_KEY", "This API key isn't allowed to use Claude models. Check the key's workspace and permissions in the Claude Console.");
  if (e?.status === 402 || type === "billing_error" || /credit balance|billing/i.test(text))
    return new ProviderError("NO_CREDIT", "Your Claude account is out of credits or has a billing problem. Add credits under Billing in the Claude Console; Tally works again as soon as they post.");
  if (e?.status === 429 || type === "rate_limit_error")
    return new ProviderError("RATE_LIMITED", "Anthropic is limiting how many requests your Claude account can send right now. Wait a minute and try again, or raise your account's limits in the Claude Console.");
  if (e?.status === 413 || type === "request_too_large" || /request.{0,20}too large|exceeds the maximum/i.test(text))
    return new ProviderError("ERROR", "The attached files are too large for Claude to read in one go. Remove some attachments, or attach a smaller file, and ask again.");
  if ((e?.status === 400 || type === "invalid_request_error") && /image|pdf|document|media type|vision/i.test(text))
    return new ProviderError("ERROR", "The Claude model chosen for Tally couldn't read one of the attached files. Try a different file, or pick another model in Settings → Tally AI.");
  if (e?.status === 529 || type === "overloaded_error") return new ProviderError("ERROR", "Claude is busy right now. Try again in a minute.");
  if (e?.status && e.status >= 500) return new ProviderError("ERROR", "Anthropic had a problem answering. Try again in a minute.");
  if (/connection|fetch failed|ENOTFOUND|ETIMEDOUT|timed out/i.test(text)) return new ProviderError("ERROR", "CannaTrace couldn't reach Anthropic. Try again in a minute.");
  console.error("[tally] unclassified provider error", e?.status, type, text.trim().slice(0, 400));
  const detail = text.trim().replace(/\s+/g, " ").slice(0, 160);
  return new ProviderError("ERROR", `Something went wrong talking to Claude${detail ? ` (${e?.status ? `${e.status}: ` : ""}${detail})` : ""}. Try again.`);
}

export type ModelOption = { id: string; name: string };
/** Checks a key with Anthropic and returns the models it can use. Costs nothing: it only lists models. */
export type Validator = (apiKey: string) => Promise<ModelOption[]>;

const anthropicValidator: Validator = async (apiKey) => {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });
  const models: ModelOption[] = [];
  for await (const m of client.models.list({ limit: 100 })) models.push({ id: m.id, name: m.display_name || m.id });
  return models;
};

/** Automated tests run with ASSISTANT_FAKE=1 and no network: these made-up keys stand in for real ones. */
const fakeValidator: Validator = async (apiKey) => {
  if (apiKey.includes("bad")) throw new ProviderError("INVALID_KEY", explainProviderError({ status: 401 }).message);
  if (apiKey.includes("nocredit")) throw explainProviderError({ status: 402 });
  return [
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  ];
};

export function defaultValidator(): Validator {
  return process.env.ASSISTANT_FAKE === "1" ? fakeValidator : anthropicValidator;
}

/** The model to use: the one asked for, or the current one, or CannaTrace's default, if the key can use it. */
function pickModel(models: ModelOption[], wanted: (string | null | undefined)[]): string {
  for (const w of wanted) if (w && models.some((m) => m.id === w)) return w;
  return models.find((m) => /sonnet/.test(m.id))?.id ?? models[0]?.id ?? DEFAULT_MODEL;
}

function needManager(session: Session) {
  if (!can(session, "ai.manage")) throw new InventoryError("Only an owner (or someone an owner has allowed) can manage the Tally AI connection.");
}

const auditName = (session: Session) => session.name;

async function log(session: Session, action: string, after: Record<string, unknown>) {
  // Only the key's hint is ever logged, never the key.
  await db.insert(auditLogs).values({
    orgId: session.orgId,
    facilityId: session.facilityId,
    userId: session.userId,
    userName: auditName(session),
    entityType: "TallyAI",
    entityId: session.orgId,
    action,
    after,
  });
}

export type ConnectionView = {
  connected: boolean;
  storageReady: boolean;
  keyHint: string | null;
  model: string | null;
  availableModels: ModelOption[];
  status: string | null;
  statusMessage: string | null;
  checkedAt: Date | null;
  connectedByName: string | null;
  connectedAt: Date | null;
  enabled: boolean;
  limits: { dailyLimit: number; monthlyLimit: number; perPersonDailyLimit: number; maxAnswerTokens: number };
};

const DEFAULT_LIMITS = { dailyLimit: 300, monthlyLimit: 5000, perPersonDailyLimit: 60, maxAnswerTokens: 2048 };

/** What the settings page may show. Never includes the key. */
export async function getConnection(orgId: string): Promise<ConnectionView> {
  const [row] = await db.select().from(aiConnections).where(eq(aiConnections.orgId, orgId));
  if (!row)
    return {
      connected: false,
      storageReady: encryptionReady(),
      keyHint: null,
      model: null,
      availableModels: [],
      status: null,
      statusMessage: null,
      checkedAt: null,
      connectedByName: null,
      connectedAt: null,
      enabled: true,
      limits: DEFAULT_LIMITS,
    };
  return {
    connected: true,
    storageReady: encryptionReady(),
    keyHint: row.keyHint,
    model: row.model,
    availableModels: row.availableModels,
    status: row.status,
    statusMessage: row.statusMessage,
    checkedAt: row.checkedAt,
    connectedByName: row.connectedByName,
    connectedAt: row.connectedAt,
    enabled: row.enabled,
    limits: { dailyLimit: row.dailyLimit, monthlyLimit: row.monthlyLimit, perPersonDailyLimit: row.perPersonDailyLimit, maxAnswerTokens: row.maxAnswerTokens },
  };
}

/** Connect a key, or replace the current one. The key is checked with Anthropic first and stored only if it works. */
export async function connectKey(session: Session, input: { apiKey: string; model?: string }, validate: Validator = defaultValidator()): Promise<ConnectionView> {
  needManager(session);
  const apiKey = input.apiKey.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{16,}$/.test(apiKey)) throw new InventoryError("That doesn't look like a Claude API key. Keys start with sk-ant- and are about 100 characters long. Copy the whole key from the Claude Console.");
  if (!encryptionReady()) throw new InventoryError("Secure key storage isn't set up on this CannaTrace server yet, so keys can't be saved. Ask CannaTrace support to finish setup.");
  let models: ModelOption[];
  try {
    models = await validate(apiKey);
  } catch (error) {
    throw new InventoryError(explainProviderError(error).message);
  }
  if (models.length === 0) throw new InventoryError("This key works but can't use any Claude models. Check its workspace in the Claude Console.");
  const [existing] = await db.select({ model: aiConnections.model }).from(aiConnections).where(eq(aiConnections.orgId, session.orgId));
  const model = pickModel(models, [input.model, existing?.model, DEFAULT_MODEL]);
  const values = {
    encryptedKey: sealSecret(apiKey, session.orgId),
    keyHint: keyHint(apiKey),
    model,
    availableModels: models,
    status: "CONNECTED",
    statusMessage: null,
    checkedAt: new Date(),
    connectedByName: auditName(session),
    connectedAt: new Date(),
  };
  await db
    .insert(aiConnections)
    .values({ orgId: session.orgId, ...values })
    .onConflictDoUpdate({ target: aiConnections.orgId, set: values });
  await log(session, existing ? "KEY_REPLACED" : "KEY_CONNECTED", { keyHint: values.keyHint, model });
  return getConnection(session.orgId);
}

/** Check the saved key again (free) and refresh the model list and status. */
export async function checkConnection(session: Session, validate: Validator = defaultValidator()): Promise<ConnectionView> {
  needManager(session);
  const [row] = await db.select().from(aiConnections).where(eq(aiConnections.orgId, session.orgId));
  if (!row) throw new InventoryError("Tally isn't connected yet.");
  const apiKey = openSecret(row.encryptedKey, session.orgId);
  try {
    const models = await validate(apiKey);
    await db
      .update(aiConnections)
      .set({
        availableModels: models,
        model: pickModel(models, [row.model, DEFAULT_MODEL]),
        status: "CONNECTED",
        statusMessage: null,
        checkedAt: new Date(),
        ...(needsReseal(row.encryptedKey) ? { encryptedKey: sealSecret(apiKey, session.orgId) } : {}),
      })
      .where(eq(aiConnections.orgId, session.orgId));
  } catch (error) {
    const problem = explainProviderError(error);
    await markProblem(session.orgId, problem);
  }
  return getConnection(session.orgId);
}

export async function setModel(session: Session, model: string): Promise<void> {
  needManager(session);
  const [row] = await db.select({ models: aiConnections.availableModels }).from(aiConnections).where(eq(aiConnections.orgId, session.orgId));
  if (!row) throw new InventoryError("Connect Tally first.");
  if (!row.models.some((m) => m.id === model)) throw new InventoryError("Choose one of the models your Claude account can use.");
  await db.update(aiConnections).set({ model }).where(eq(aiConnections.orgId, session.orgId));
  await log(session, "MODEL_CHANGED", { model });
}

const whole = (value: unknown, what: string, min: number, max: number) => {
  const n = Number(String(value ?? "").trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new InventoryError(`${what} must be a whole number from ${min} to ${max.toLocaleString("en-US")}.`);
  return n;
};

export async function setLimits(
  session: Session,
  input: { dailyLimit: unknown; monthlyLimit: unknown; perPersonDailyLimit: unknown; maxAnswerTokens: unknown; enabled: boolean },
): Promise<void> {
  needManager(session);
  const limits = {
    dailyLimit: whole(input.dailyLimit, "Questions per day for the business", 1, 100_000),
    monthlyLimit: whole(input.monthlyLimit, "Questions per month for the business", 1, 1_000_000),
    perPersonDailyLimit: whole(input.perPersonDailyLimit, "Questions per person per day", 1, 10_000),
    maxAnswerTokens: whole(input.maxAnswerTokens, "Longest answer", 256, 8192),
    enabled: input.enabled,
  };
  if (limits.perPersonDailyLimit > limits.dailyLimit) throw new InventoryError("The per-person limit can't be more than the business's daily limit.");
  if (limits.dailyLimit > limits.monthlyLimit) throw new InventoryError("The daily limit can't be more than the monthly limit.");
  const updated = await db.update(aiConnections).set(limits).where(eq(aiConnections.orgId, session.orgId)).returning({ orgId: aiConnections.orgId });
  if (!updated.length) throw new InventoryError("Connect Tally first.");
  await log(session, "LIMITS_CHANGED", limits);
}

/** Remove the key from CannaTrace. (It still exists in the Claude Console; delete it there too if it's no longer needed.) */
export async function disconnect(session: Session): Promise<void> {
  needManager(session);
  const [row] = await db.delete(aiConnections).where(eq(aiConnections.orgId, session.orgId)).returning({ keyHint: aiConnections.keyHint });
  if (row) await log(session, "KEY_DISCONNECTED", { keyHint: row.keyHint });
}

export async function markProblem(orgId: string, problem: ProviderError): Promise<void> {
  await db
    .update(aiConnections)
    .set({ status: problem.kind, statusMessage: problem.message, checkedAt: new Date() })
    .where(eq(aiConnections.orgId, orgId));
}

export async function markHealthy(orgId: string): Promise<void> {
  await db
    .update(aiConnections)
    .set({ status: "CONNECTED", statusMessage: null })
    .where(and(eq(aiConnections.orgId, orgId), sql`${aiConnections.status} <> 'CONNECTED'`));
}

// ---------- Which account pays for a Tally question ----------

export type TallyRoute =
  | { kind: "fake"; model: string; maxTokens: number; limits: ConnectionView["limits"] }
  | { kind: "customer"; apiKey: string; model: string; maxTokens: number; limits: ConnectionView["limits"] }
  | { kind: "platform"; apiKey: string; model: string; maxTokens: number; limits: ConnectionView["limits"] }
  | { kind: "off"; reason: "NOT_CONNECTED" | "PAUSED" | "KEY_UNREADABLE" };

function platformAllowed(orgId: string, isDemo: boolean): boolean {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  if (isDemo) return true;
  const listed = (process.env.TALLY_PLATFORM_ORGS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (listed.includes(orgId)) return true;
  // Local development only, and only when a developer asks for it.
  return process.env.NODE_ENV !== "production" && process.env.TALLY_DEV_USE_PLATFORM_KEY === "1";
}

/** Decide whose Claude account answers this person's question. Always scoped to their own business. */
export async function resolveTally(session: Pick<Session, "orgId" | "isDemo">): Promise<TallyRoute> {
  if (process.env.ASSISTANT_FAKE === "1") {
    const [row] = await db.select().from(aiConnections).where(eq(aiConnections.orgId, session.orgId));
    if (row && !row.enabled) return { kind: "off", reason: "PAUSED" };
    return { kind: "fake", model: row?.model ?? DEFAULT_MODEL, maxTokens: row?.maxAnswerTokens ?? 2048, limits: row ?? DEFAULT_LIMITS };
  }
  const [row] = await db.select().from(aiConnections).where(eq(aiConnections.orgId, session.orgId));
  if (row) {
    if (!row.enabled) return { kind: "off", reason: "PAUSED" };
    try {
      return { kind: "customer", apiKey: openSecret(row.encryptedKey, session.orgId), model: row.model, maxTokens: row.maxAnswerTokens, limits: row };
    } catch {
      return { kind: "off", reason: "KEY_UNREADABLE" };
    }
  }
  if (platformAllowed(session.orgId, Boolean(session.isDemo)))
    return { kind: "platform", apiKey: process.env.ANTHROPIC_API_KEY!, model: DEFAULT_MODEL, maxTokens: 2048, limits: DEFAULT_LIMITS };
  return { kind: "off", reason: "NOT_CONNECTED" };
}

/** Whether Tally can answer for this business right now, without loading the key. For the panel. */
export async function tallyAvailability(session: Pick<Session, "orgId" | "isDemo">): Promise<{ ready: boolean; reason: string | null }> {
  if (process.env.ASSISTANT_FAKE === "1") {
    const [row] = await db.select({ enabled: aiConnections.enabled }).from(aiConnections).where(eq(aiConnections.orgId, session.orgId));
    return row && !row.enabled ? { ready: false, reason: "PAUSED" } : { ready: true, reason: null };
  }
  const [row] = await db.select({ enabled: aiConnections.enabled }).from(aiConnections).where(eq(aiConnections.orgId, session.orgId));
  if (row) return row.enabled ? { ready: true, reason: null } : { ready: false, reason: "PAUSED" };
  return platformAllowed(session.orgId, Boolean(session.isDemo)) ? { ready: true, reason: null } : { ready: false, reason: "NOT_CONNECTED" };
}

// ---------- Limits and usage ----------

const DAY_MS = 24 * 60 * 60 * 1000;
function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Refuse a question that would go over the business's or the person's limits. */
/** How long a reservation may stay open before it stops counting (a request runs for at most 60 seconds). */
export const RESERVATION_MS = 10 * 60 * 1000;

type Executor = Pick<typeof db, "execute">;

/** The questions that count toward the limits (see assertUnderLimits), as a SQL condition on ai_usage. */
const countsToward = (now: Date) =>
  sql`(outcome = 'OK' or input_tokens + output_tokens > 0 or (outcome = 'PENDING' and created_at > ${new Date(now.getTime() - RESERVATION_MS)}))`;

/**
 * A question counts toward the limits when it is in flight (reserved, not yet settled, and recent), was
 * answered, or spent tokens. A request that was cancelled or failed before Claude used any tokens is
 * released and stops counting. One that spent tokens keeps counting even if it then failed or was
 * cancelled: the business paid for it, and otherwise starting and cancelling questions would get around
 * the limit.
 */
async function assertUnderLimits(ex: Executor, session: Pick<Session, "orgId" | "userId">, limits: ConnectionView["limits"], now: Date): Promise<void> {
  const counts = countsToward(now);
  const [c] = (
    await ex.execute<{ day: number; month: number; mine: number }>(sql`
      select
        count(*) filter (where created_at > ${new Date(now.getTime() - DAY_MS)} and ${counts})::int as day,
        count(*) filter (where created_at >= ${monthStart(now)} and ${counts})::int as month,
        count(*) filter (where created_at > ${new Date(now.getTime() - DAY_MS)} and user_id = ${session.userId} and ${counts})::int as mine
      from ai_usage where org_id = ${session.orgId} and created_at >= ${new Date(Math.min(monthStart(now).getTime(), now.getTime() - DAY_MS))}`)
  ).rows;
  if (c.mine >= limits.perPersonDailyLimit)
    throw new InventoryError(
      `You've reached this business's limit of ${limits.perPersonDailyLimit} Tally question${limits.perPersonDailyLimit === 1 ? "" : "s"} per person in 24 hours. An owner can raise it in Settings → Tally AI.`,
    );
  if (c.day >= limits.dailyLimit)
    throw new InventoryError(`Your business has used its ${limits.dailyLimit} Tally questions for the last 24 hours. An owner can raise the limit in Settings → Tally AI.`);
  if (c.month >= limits.monthlyLimit)
    throw new InventoryError(`Your business has used its ${limits.monthlyLimit} Tally questions for this month. An owner can raise the limit in Settings → Tally AI.`);
}

/** Whether one more question fits under the limits right now. A read only: use reserveUsage to take the slot. */
export async function checkLimits(session: Pick<Session, "orgId" | "userId">, limits: ConnectionView["limits"], now = new Date()): Promise<void> {
  await assertUnderLimits(db, session, limits, now);
}

/**
 * Take one question's slot before Claude is called. Requests for the same business wait their turn on a
 * lock while they count and reserve, so questions sent at the same moment can't all slip under the limit.
 * Returns the reservation, to be settled with settleUsage when the answer ends (however it ends).
 */
export async function reserveUsage(
  session: Pick<Session, "orgId" | "userId" | "name" | "facilityId" | "supportVisit">,
  route: Exclude<TallyRoute, { kind: "off" }>,
  now = new Date(),
): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai_usage:${session.orgId}`}, 0))`);
    await assertUnderLimits(tx, session, route.limits, now);
    const [row] = await tx
      .insert(aiUsage)
      .values({
        orgId: session.orgId,
        userId: session.userId,
        userName: session.name,
        facilityId: session.facilityId,
        billedTo: route.kind === "customer" ? "CUSTOMER" : route.kind === "platform" ? "PLATFORM" : "TEST",
        model: route.model,
        outcome: "PENDING",
        supportVisit: Boolean(session.supportVisit),
        createdAt: now,
      })
      .returning({ id: aiUsage.id });
    return row.id;
  });
}

/** Close a reservation with what the request actually used and how it ended. Settles once; later calls do nothing. */
export async function settleUsage(reservationId: string, result: { inputTokens: number; outputTokens: number; outcome: string }): Promise<void> {
  await db
    .update(aiUsage)
    .set({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, outcome: result.outcome === "PENDING" ? "ERROR" : result.outcome })
    .where(and(eq(aiUsage.id, reservationId), eq(aiUsage.outcome, "PENDING")));
}

export async function recordUsage(
  session: Pick<Session, "orgId" | "userId" | "name" | "facilityId" | "supportVisit">,
  route: Exclude<TallyRoute, { kind: "off" }>,
  result: { inputTokens: number; outputTokens: number; outcome: string },
): Promise<void> {
  await db.insert(aiUsage).values({
    orgId: session.orgId,
    userId: session.userId,
    userName: session.name,
    facilityId: session.facilityId,
    billedTo: route.kind === "customer" ? "CUSTOMER" : route.kind === "platform" ? "PLATFORM" : "TEST",
    model: route.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    outcome: result.outcome,
    supportVisit: Boolean(session.supportVisit),
  });
}

export type UsageSummary = {
  last24h: number;
  thisMonth: number;
  inputTokens: number;
  outputTokens: number;
  failures: number;
  /** Estimated dollars at Anthropic's list prices, for questions on the business's own key. */
  cost: {
    thisMonth: number;
    lastMonth: number;
    /** Average for a question that got an answer this month, or null before the first one. */
    perQuestion: number | null;
    /** Models used this month whose price isn't known, so their tokens aren't in the estimate. */
    unpricedModels: string[];
  };
  people: { name: string; questions: number; cost: number }[];
  recentProblems: { at: Date; outcome: string; name: string }[];
};

/** Tally use for the settings page. Counts and tokens only: CannaTrace can't see the Claude account's balance. */
export async function usageSummary(orgId: string, now = new Date()): Promise<UsageSummary> {
  const since = monthStart(now);
  const [totals] = (
    await db.execute<{ day: number; month: number; input: number; output: number; failures: number }>(sql`
      select
        count(*) filter (where created_at > ${new Date(now.getTime() - DAY_MS)} and ${countsToward(now)})::int as day,
        count(*) filter (where created_at >= ${since} and ${countsToward(now)})::int as month,
        coalesce(sum(input_tokens) filter (where created_at >= ${since}), 0)::int as input,
        coalesce(sum(output_tokens) filter (where created_at >= ${since}), 0)::int as output,
        count(*) filter (where created_at >= ${since} and outcome not in ('OK', 'PENDING'))::int as failures
      from ai_usage where org_id = ${orgId}`)
  ).rows;
  const people = (
    await db.execute<{ name: string; questions: number }>(sql`
      select user_name as name, count(*)::int as questions from ai_usage
      where org_id = ${orgId} and created_at >= ${since} and ${countsToward(now)}
      group by user_name order by questions desc limit 8`)
  ).rows;
  // Tokens by month, person, and model on the business's own key; turned into dollars per model below.
  const lastMonthStart = monthStart(new Date(since.getTime() - 1));
  const spend = (
    await db.execute<{ month: string; name: string; model: string; input: number; output: number; answered: number }>(sql`
      select case when created_at >= ${since} then 'this' else 'last' end as month, user_name as name, model,
        coalesce(sum(input_tokens), 0)::bigint as input, coalesce(sum(output_tokens), 0)::bigint as output,
        count(*) filter (where outcome = 'OK')::int as answered
      from ai_usage
      where org_id = ${orgId} and billed_to = 'CUSTOMER' and created_at >= ${lastMonthStart}
      group by 1, 2, 3`)
  ).rows;
  const cost = { thisMonth: 0, lastMonth: 0, perQuestion: null as number | null, unpricedModels: [] as string[] };
  const personCost = new Map<string, number>();
  let answered = 0;
  for (const row of spend) {
    const dollars = costUsd(row.model, Number(row.input), Number(row.output));
    if (dollars === null) {
      if (row.month === "this" && !cost.unpricedModels.includes(row.model)) cost.unpricedModels.push(row.model);
      continue;
    }
    if (row.month === "last") cost.lastMonth += dollars;
    else {
      cost.thisMonth += dollars;
      answered += Number(row.answered);
      personCost.set(row.name, (personCost.get(row.name) ?? 0) + dollars);
    }
  }
  cost.perQuestion = answered ? cost.thisMonth / answered : null;
  const recentProblems = await db
    .select({ at: aiUsage.createdAt, outcome: aiUsage.outcome, name: aiUsage.userName })
    .from(aiUsage)
    .where(and(eq(aiUsage.orgId, orgId), sql`${aiUsage.outcome} not in ('OK', 'PENDING')`, gt(aiUsage.createdAt, new Date(now.getTime() - 7 * DAY_MS))))
    .orderBy(desc(aiUsage.createdAt))
    .limit(5);
  return {
    last24h: totals.day,
    thisMonth: totals.month,
    inputTokens: totals.input,
    outputTokens: totals.output,
    failures: totals.failures,
    cost,
    people: people.map((p) => ({ ...p, cost: personCost.get(p.name) ?? 0 })),
    recentProblems,
  };
}
