import "server-only";
import { listShoppers, loyaltyAnalytics } from "@/lib/loyalty";
import { SEGMENTS } from "@/lib/loyalty-math";
import { createCampaign } from "@/lib/marketing";
import { checkMessage, prepareBody } from "@/lib/marketing-rules";
import { getMarketingSettings } from "@/lib/loyalty-earn";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";
import type { Tool } from "./tools";

/**
 * Marketing for Tally and the AI connector: see how the program is doing, list shoppers by group, and write a campaign draft.
 * Tally never sends a message: a person reviews the draft's message check and sends it from Marketing → Campaigns.
 * Phone numbers and emails are never returned: first names and numbers are enough to answer a question.
 */

type Input = Record<string, unknown>;
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const text = (description: string) => ({ type: "string", description });
const SEGMENT_KEYS = SEGMENTS.map((s) => s.key);

export const LOYALTY_TOOLS: Tool[] = [
  {
    kind: "read",
    name: "loyalty_overview",
    label: "Looking at the rewards program",
    permission: "pos.manage",
    description:
      "How the rewards program and customer groups are doing: members, come-back rate, share of sales from members, what outstanding points are worth, shoppers in each group (VIP, REGULAR, NEW, AT_RISK, LAPSED), signup-month retention, and messages sent in the last 30 days.",
    schema: obj({}),
    run: async (s) => {
      const a = await loyaltyAnalytics(s.orgId);
      return {
        members: a.members,
        groups: a.counts,
        come_back_rate_percent: a.repeatRate,
        average_spend_last_12_months_dollars: a.avgSpend12m,
        member_share_of_sales_percent: a.memberShare,
        member_sales_last_12_months_dollars: a.memberSales,
        average_member_sale_dollars: a.avgBasketMember,
        points_outstanding: a.pointsOut,
        points_owed_dollars: a.liability,
        signup_month_retention: a.cohorts,
        messages_last_30_days: a.messages30,
      };
    },
  },
  {
    kind: "read",
    name: "loyalty_shoppers",
    label: "Looking up shoppers",
    permission: "pos.manage",
    description:
      "Rewards shoppers, optionally in one group: VIP (best, bought in last 45 days), REGULAR, NEW, AT_RISK (last bought 46-90 days ago), LAPSED (over 90 days). Shows first name, group, tier, visits, spend in the last 12 months, last purchase and points. Never phone numbers or emails.",
    schema: obj({ segment: { type: "string", enum: SEGMENT_KEYS, description: "Only this group." }, search: text("Part of a first name."), limit: { type: "integer" } }),
    run: async (s, input) => {
      const segment = str(input.segment);
      if (segment && !SEGMENT_KEYS.includes(segment as (typeof SEGMENT_KEYS)[number])) throw new InventoryError(`Group must be one of ${SEGMENT_KEYS.join(", ")}.`);
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
      const list = await listShoppers(s.orgId, { segment: segment || undefined, q: str(input.search, 40), pageSize: limit });
      return {
        matching: list.matching,
        shown: list.rows.length,
        shoppers: list.rows.map((r) => ({
          first_name: r.firstName,
          group: r.segment,
          tier: r.tier?.name ?? null,
          visits: r.visits,
          spent_last_12_months_dollars: r.spend12m,
          last_purchase: r.lastPurchaseAt ? r.lastPurchaseAt.toISOString().slice(0, 10) : null,
          points: r.points,
        })),
      };
    },
  },
  {
    kind: "action",
    name: "draft_campaign",
    label: "Writing the campaign draft",
    permission: "pos.manage",
    description:
      "Write a marketing campaign DRAFT for a group of shoppers (not sent). Use {first_name}, {points}, {shop}, {card_link} in the message. Offer discounts or bonus points only: never free cannabis, nothing aimed at minors, no health claims. The required statement is added automatically. A person reviews the message check and sends it from Marketing → Campaigns. Nothing is saved until Confirm.",
    schema: obj(
      {
        name: text("A short name only the store sees."),
        channel: { type: "string", enum: ["EMAIL", "SMS"] },
        segment: { type: "string", enum: ["ALL", ...SEGMENT_KEYS, "BIRTHDAY"], description: "Who it goes to." },
        subject: text("Email subject. Required for EMAIL."),
        message: text("The message body."),
      },
      ["name", "channel", "segment", "message"],
    ),
    propose: async (s, input: Input) => {
      const channel = input.channel === "SMS" ? "SMS" : "EMAIL";
      const segment = str(input.segment) || "ALL";
      if (segment !== "ALL" && segment !== "BIRTHDAY" && !SEGMENT_KEYS.includes(segment as (typeof SEGMENT_KEYS)[number])) throw new InventoryError("Pick who it goes to.");
      const name = str(input.name, 60);
      const message = str(input.message, 4000);
      if (!name || !message) throw new InventoryError("A campaign needs a name and a message.");
      const settings = await getMarketingSettings(db, s.orgId);
      const prepared = prepareBody(channel, message, settings.disclaimer);
      const problems = checkMessage({ channel, subject: str(input.subject), body: prepared, disclaimer: settings.disclaimer });
      const blocking = problems.find((p) => p.severity === "block");
      if (blocking) throw new InventoryError(`That message can't be used: ${blocking.message} Reword it and try again.`);
      return {
        title: `Campaign draft: ${name}`,
        details: [
          { label: "Channel", value: channel === "SMS" ? "Text message" : "Email" },
          { label: "Goes to", value: segment },
          ...(channel === "EMAIL" ? [{ label: "Subject", value: str(input.subject) }] : []),
          { label: "Message", value: prepared },
          ...problems.map((p) => ({ label: "Note", value: p.message })),
          { label: "Not sent", value: "This only saves a draft. Send it from Marketing → Campaigns." },
        ],
        action: { tool: "draft_campaign", args: { name, channel, segment, subject: str(input.subject), body: message } },
      };
    },
    execute: async (actor, a) => {
      const campaign = await createCampaign(actor, a);
      return `Draft "${campaign.name}" saved. Open Marketing → Campaigns to check who it reaches and send it.`;
    },
  },
];
