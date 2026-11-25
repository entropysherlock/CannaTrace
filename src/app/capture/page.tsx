import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { CaptureScreen } from "@/components/capture-screen";
import { facilities } from "@/db/schema";
import { db } from "@/lib/db";
import { currentSession } from "@/lib/session";

export const instant = false;
export const metadata = { title: "Take a photo | Leaf2Sale", robots: { index: false } };

/** The phone's home screen: open it, take a photo, done. A linked phone signs itself back in. */
export default async function CapturePage({ searchParams }: { searchParams: Promise<{ linked?: string }> }) {
  const session = await currentSession();
  // The proxy sends a signed-out phone to sign back in before this page is reached; this covers a sign-in that just went stale.
  if (!session) redirect("/signout");
  const [facility] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, session.facilityId));
  const { linked } = await searchParams;
  return <CaptureScreen person={session.name} store={facility?.name ?? ""} justLinked={linked === "1"} />;
}
