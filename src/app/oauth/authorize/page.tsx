import { eq } from "drizzle-orm";
import { facilities } from "@/db/schema";
import { Logo } from "@/components/logo";
import { db } from "@/lib/db";
import { OAuthError, parseAuthorize } from "@/lib/oauth";
import { can } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { decide } from "./actions";

export const metadata = { title: "Connect an app · Leaf2Sale", robots: { index: false } };
export const instant = false;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4">
      <Logo size="lg" />
      <div className="mt-6 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">{children}</div>
    </main>
  );
}

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let req;
  try {
    req = await parseAuthorize(params);
  } catch (error) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-slate-900">We could not connect that app</h1>
        <p className="mt-2 text-sm text-slate-700">{error instanceof OAuthError ? error.message : "Start the connection again from the app."}</p>
      </Shell>
    );
  }
  const session = await requireSession();
  if (session.isDemo || !can(session, "integrations.manage")) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-slate-900">Only an owner can connect an app</h1>
        <p className="mt-2 text-sm text-slate-700">
          {session.isDemo ? "Connections are switched off in the shared live demo. Create your own account to try this." : "Ask an owner of this business to connect the app, or to make you an owner."}
        </p>
      </Shell>
    );
  }
  const [facility] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, session.facilityId));
  return (
    <Shell>
      <h1 className="text-xl font-bold text-slate-900">Connect {req.clientName} to Leaf2Sale?</h1>
      <p className="mt-2 text-sm text-slate-700">
        This lets <strong>{req.clientName}</strong> look up information in <strong>{facility?.name ?? "this facility"}</strong>. It works for this facility only. To connect a different one, switch facility first.
      </p>
      <form action={decide} className="mt-4 space-y-4">
        <input type="hidden" name="client_id" value={req.clientId} />
        <input type="hidden" name="redirect_uri" value={req.redirectUri} />
        <input type="hidden" name="code_challenge" value={req.challenge} />
        <input type="hidden" name="state" value={req.state} />
        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input type="checkbox" name="canWrite" className="mt-1 h-4 w-4" />
          <span>
            <strong>Also allow changes</strong> (inventory, orders, production). Every change is recorded in the audit trail under this connection and can be undone. Leave this off to let it read only.
          </span>
        </label>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">You can remove this connection any time under Settings → Integrations by revoking its key.</p>
        <div className="flex gap-3">
          <button name="decision" value="approve" className="min-h-11 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800">
            Approve
          </button>
          <button name="decision" value="deny" className="min-h-11 flex-1 rounded-lg border border-slate-300 px-4 font-semibold text-slate-800 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </form>
    </Shell>
  );
}
