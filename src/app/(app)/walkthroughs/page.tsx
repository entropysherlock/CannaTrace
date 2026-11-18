import { PageHeader } from "@/components/ui";
import { WalkthroughList } from "@/components/walkthrough";
import { can } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { WALKTHROUGHS } from "@/lib/walkthroughs";

export const metadata = { title: "Walkthroughs · CannaTrace" };

/** Every guided walkthrough this person's role can do, to start one. */
export default async function WalkthroughsPage() {
  const session = await requireSession();
  const allowed = WALKTHROUGHS.filter((w) => can(session, w.permission)).map((w) => w.id);
  return (
    <>
      <PageHeader title="Walkthroughs" subtitle="Pick a job. CannaTrace highlights each step, page to page, on your real data. Nothing is saved unless you save it." />
      <WalkthroughList allowed={allowed} />
    </>
  );
}
