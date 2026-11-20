import Link from "next/link";
import { Logo } from "@/components/logo";
import { checkPairing } from "@/lib/devices";
import { linkPhoneAction } from "./actions";

export const instant = false;
export const metadata = { title: "Link this phone to CannaTrace", robots: { index: false } };

const PROBLEMS = {
  invalid: "This link isn't valid. Open Account on your computer and show a new QR code.",
  used: "This link was already used. If this phone is already linked, open CannaTrace from its home screen. Otherwise show a new QR code.",
  expired: "This link expired (they last 10 minutes). Show a new QR code on your computer and scan it again.",
};

export default async function LinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const check = await checkPairing(code);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4 py-10">
      <Link href="/" className="mb-6">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">
        {check.ok ? (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Link this phone</h1>
            <p className="mb-5 mt-1 text-sm text-slate-600">
              This phone will be linked to <strong className="text-slate-900">{check.name}</strong>&apos;s account. It can take and send photos of paperwork
              and stay signed in. You can unlink it any time under Account.
            </p>
            <form action={linkPhoneAction}>
              <input type="hidden" name="code" value={code} />
              <button type="submit" className="min-h-14 w-full rounded-xl bg-brand-700 text-lg font-bold text-white hover:bg-brand-800">
                Link this phone
              </button>
            </form>
            <p className="mt-4 text-xs text-slate-500">Only link a phone you trust. If you didn&apos;t ask for this, close the page.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900">This link can&apos;t be used</h1>
            <p className="mt-2 text-sm text-slate-600" data-testid="link-problem">
              {PROBLEMS[check.reason]}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
