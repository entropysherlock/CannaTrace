import { PageHeader } from "@/components/ui";
import { WalkthroughList } from "@/components/walkthrough";
import { can } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { eq } from "drizzle-orm";
import { facilities } from "@/db/schema";
import { db } from "@/lib/db";
import { walkthroughsFor } from "@/lib/walkthroughs";

export const metadata = { title: "Walkthroughs · Leaf2Sale" };

/** Every guided walkthrough this person's role can do, to start one. */
export default async function WalkthroughsPage() {
  const session = await requireSession();
  const [here] = await db.select({ licenseType: facilities.licenseType }).from(facilities).where(eq(facilities.id, session.facilityId));
  const allowed = walkthroughsFor((p) => can(session, p), here?.licenseType);
  return (
    <>
      <PageHeader title="Walkthroughs" subtitle="Pick a job. Leaf2Sale highlights each step, page to page, on your real data. Nothing is saved unless you save it." />
      <WalkthroughList allowed={allowed} />
    </>
  );
}
