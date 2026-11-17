import "server-only";
import { signProposal } from "@/lib/assistant/engine";
import { TOOLS } from "@/lib/assistant/tools";
import { InventoryError } from "@/lib/inventory-math";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { findingFor } from "./index";

/**
 * Turn a finding's fix into a plan card, through the same Tally tool, checks, and signing as a chat
 * request. Nothing changes until the person confirms it; the change can then be undone.
 */
export async function prepareFix(session: Session, findingId: string) {
  const finding = await findingFor(session, findingId);
  if (!finding.fix) throw new InventoryError("This one needs a person to look at it; there's no automatic fix.");
  const tool = TOOLS.find((t) => t.name === finding.fix!.tool);
  if (!tool || tool.kind !== "action") throw new InventoryError("That fix isn't available.");
  if (!can(session, tool.permission)) throw new InventoryError("Your role can't make this change. An owner or manager can.");
  const proposal = await tool.propose(session, finding.fix.input);
  if (tool.extraPermissions && !tool.extraPermissions(proposal.action.args).every((p) => can(session, p)))
    throw new InventoryError("Your role can't make every part of this change. An owner or manager can.");
  return { token: await signProposal(session, proposal), title: proposal.title, details: proposal.details, steps: proposal.steps ?? [] };
}
