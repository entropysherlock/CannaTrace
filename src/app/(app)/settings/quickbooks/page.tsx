import { ActionForm } from "@/components/action-form";
import { Card, PageHeader, inputClass } from "@/components/ui";
import { getQuickbooks, quickbooksConfigured } from "@/lib/quickbooks";
import { requirePagePermission } from "@/lib/session";
import { disconnectQuickbooksAction, syncNowAction } from "./actions";

export const metadata = { title: "QuickBooks · Leaf2Sale" };
export const instant = false;

const PROBLEMS: Record<string, string> = {
  permission: "Only people who manage settings can connect QuickBooks.",
  setup: "QuickBooks is not set up on this server yet. Ask Leaf2Sale support.",
  declined: "You chose not to connect, so nothing changed.",
  state: "That sign-in took too long or came from somewhere else. Try Connect again.",
  missing: "QuickBooks did not send back the details needed. Try Connect again.",
  failed: "The connection could not be finished. Try again, and tell support if it keeps happening.",
};

const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export default async function QuickbooksPage({ searchParams }: { searchParams: Promise<{ problem?: string; connected?: string }> }) {
  const session = await requirePagePermission("settings.manage");
  const { problem, connected } = await searchParams;
  const conn = await getQuickbooks(session.orgId);
  const ready = quickbooksConfigured();
  return (
    <div className="space-y-5">
      <PageHeader title="QuickBooks" subtitle="Send your invoices and the payments taken against them to QuickBooks Online." />
      {problem && PROBLEMS[problem] ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">
          {PROBLEMS[problem]}
        </p>
      ) : null}
      {connected ? (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          Connected. New invoices and payments go over once a day, or press Send now.
        </p>
      ) : null}
      {!conn ? (
        <Card title="Connect QuickBooks Online">
          <div className="space-y-3 text-sm text-slate-700">
            <p>One click. You sign in to Intuit, pick your company, and approve. Leaf2Sale never sees your QuickBooks password.</p>
            <p>After that, each invoice becomes a QuickBooks invoice (with the same number and due date), buyers are matched by name or created, and payments are applied to the right invoice. It only sends from Leaf2Sale to QuickBooks and never sends the same record twice.</p>
            {ready ? (
              <a href="/api/quickbooks/connect" className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800">
                Connect to QuickBooks
              </a>
            ) : (
              <p className="rounded-lg bg-amber-50 p-3 font-semibold text-amber-900">QuickBooks is not set up on this server yet. Ask Leaf2Sale support.</p>
            )}
          </div>
        </Card>
      ) : (
        <>
          <Card title={conn.companyName ? `Connected to ${conn.companyName}` : "Connected"}>
            <div className="space-y-3 text-sm text-slate-700">
              {conn.status !== "CONNECTED" ? (
                <p role="alert" className="rounded-lg bg-red-50 p-3 font-semibold text-red-800">
                  {conn.statusMessage ?? "QuickBooks needs to be reconnected."}{" "}
                  <a href="/api/quickbooks/connect" className="underline">
                    Reconnect
                  </a>
                </p>
              ) : null}
              <p>
                Connected by {conn.connectedByName} on {when(conn.connectedAt)}. Last sent {when(conn.lastSyncAt)}
                {conn.lastSyncSummary ? `: ${conn.lastSyncSummary}` : "."}
              </p>
              <p>
                Waiting to go over: <strong>{conn.pendingInvoices}</strong> invoice{conn.pendingInvoices === 1 ? "" : "s"} and <strong>{conn.pendingPayments}</strong> payment{conn.pendingPayments === 1 ? "" : "s"}. Each run sends up to 60 of each, oldest first.
              </p>
              <ActionForm action={syncNowAction} submitLabel="Send now">
                <></>
              </ActionForm>
            </div>
          </Card>
          <Card title="Disconnect">
            <ActionForm action={disconnectQuickbooksAction} submitLabel="Disconnect" className="space-y-2">
              <p className="text-sm text-slate-600">Stops sending. Nothing already in QuickBooks is changed or removed. Type disconnect to confirm.</p>
              <input name="confirm" aria-label='Type "disconnect" to confirm' autoComplete="off" className={inputClass} />
            </ActionForm>
          </Card>
        </>
      )}
    </div>
  );
}
