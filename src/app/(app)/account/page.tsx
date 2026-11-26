import { ActionForm } from "@/components/action-form";
import { LinkPhoneCard } from "@/components/link-phone-card";
import { TwoFactorCard } from "@/components/two-factor-card";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { listDevices } from "@/lib/devices";
import { requireSession } from "@/lib/session";
import { twoFactorStatus } from "@/lib/two-factor";
import { facilityZone } from "@/lib/time";
import { changePasswordAction, revokePhoneAction } from "./actions";

export default async function AccountPage() {
  const session = await requireSession();
  const [phones, zone, twoFactor] = await Promise.all([listDevices(session), facilityZone(session.facilityId), twoFactorStatus(session)]);
  const when = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone }) : "never");
  return (
    <>
      <PageHeader title="Your account" subtitle={`Signed in as ${session.name}.`} />
      <div className="max-w-lg space-y-6">
        <Card title="Your phones">
          <p className="mb-3 text-sm text-slate-600">
            Link your phone to take a photo of a lab certificate, manifest, or harvest sheet and send it straight to Leaf2Sale. A linked phone stays
            signed in, so there is nothing to type.
          </p>
          {session.support ? <p className="text-sm text-slate-600">Support visits can&apos;t link phones.</p> : <LinkPhoneCard />}
          {phones.length > 0 ? (
            <ul className="mt-5 divide-y divide-slate-100 border-t border-slate-100" data-testid="phones">
              {phones.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>
                    <span className="font-semibold">{p.name}</span>
                    {p.mine ? "" : ` · ${p.ownerName}`}
                    <span className="block text-xs text-slate-500">
                      Linked {when(p.createdAt)} · last used {when(p.lastSeenAt)}
                    </span>
                  </span>
                  <ActionForm action={revokePhoneAction} submitLabel="Unlink" quiet>
                    <input type="hidden" name="id" value={p.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        <Card title="Two-step sign-in">
          {session.support ? (
            <p className="text-sm text-slate-600">Support visits can&apos;t change a customer&apos;s sign-in.</p>
          ) : session.isDemo ? (
            <p className="text-sm text-slate-600">Everyone shares the live demo account, so two-step sign-in is off here. Create your own account to use it.</p>
          ) : (
            <TwoFactorCard enabled={twoFactor.enabled} since={twoFactor.since?.toISOString() ?? null} recoveryLeft={twoFactor.recoveryLeft} ready={twoFactor.ready} />
          )}
        </Card>
        <Card title="Change your password">
          {session.support ? (
            <p className="text-sm text-slate-600">Support visits can&apos;t change a customer&apos;s password.</p>
          ) : (
            <ActionForm action={changePasswordAction} submitLabel="Change password">
              <Field label="Current password">
                <input name="current" type="password" required autoComplete="current-password" className={inputClass} />
              </Field>
              <Field label="New password" hint="At least 12 characters. Changing it also unlinks your phones.">
                <input name="next" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
              </Field>
              <Field label="New password again">
                <input name="confirm" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
              </Field>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
