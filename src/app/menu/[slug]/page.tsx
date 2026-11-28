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
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
      <OnlineMenu menu={menu} />
      <footer className="bg-brand-950 text-brand-100">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 pb-24 sm:grid-cols-2 lg:pb-10">
          <div>
            <p className="text-lg font-extrabold text-white">{menu.storeName}</p>
            <p className="text-sm text-brand-200">{menu.businessName}</p>
          </div>
          <div className="text-sm sm:text-right">
            <p className="font-semibold text-white">For adults 21 and older. Please consume responsibly.</p>
            <p className="mt-1 text-brand-200">Prices before tax. Bring a valid ID; you pay in the store.</p>
            <p className="mt-4 text-xs text-brand-300">Menu by Leaf2Sale</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
