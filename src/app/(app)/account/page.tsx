import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { changePasswordAction } from "./actions";

export default async function AccountPage() {
  const session = await requireSession();
  return (
    <>
      <PageHeader title="Your password" subtitle={`Signed in as ${session.name}.`} />
      <div className="max-w-lg">
        <Card title="Change your password">
          {session.support ? (
            <p className="text-sm text-slate-600">Support visits can&apos;t change a customer&apos;s password.</p>
          ) : (
            <ActionForm action={changePasswordAction} submitLabel="Change password">
              <Field label="Current password">
                <input name="current" type="password" required autoComplete="current-password" className={inputClass} />
              </Field>
              <Field label="New password" hint="At least 12 characters.">
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
