import { notFound } from "next/navigation";
import { OnlineMenu } from "@/components/online-menu";
import { publicMenu } from "@/lib/online-menu";

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const menu = await publicMenu((await params).slug);
  return menu ? { title: `${menu.storeName} menu`, description: `Menu and pickup reservations for ${menu.storeName}.` } : { title: "Menu" };
}

export default async function MenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const menu = await publicMenu((await params).slug);
  if (!menu) notFound();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-5 py-5">
          <h1 className="text-2xl font-extrabold text-brand-950 sm:text-3xl">{menu.storeName}</h1>
          <p className="text-sm text-slate-600">{menu.businessName}</p>
          {menu.welcome ? <p className="mt-2 max-w-2xl whitespace-pre-line text-slate-700">{menu.welcome}</p> : null}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">
        <OnlineMenu menu={menu} />
      </main>
      <footer className="mx-auto max-w-5xl px-5 pb-10 text-xs text-slate-500">For adults 21 and older. Please consume responsibly.</footer>
    </div>
  );
}
