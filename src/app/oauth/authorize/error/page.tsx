import { Logo } from "@/components/logo";

export const metadata = { title: "Connection problem · Leaf2Sale", robots: { index: false } };

export default async function ConnectionProblem({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4">
      <Logo size="lg" />
      <div className="mt-6 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <h1 className="text-xl font-bold text-slate-900">We could not connect that app</h1>
        <p className="mt-2 text-sm text-slate-700">{(m ?? "Start the connection again from the app.").slice(0, 300)}</p>
      </div>
    </main>
  );
}
