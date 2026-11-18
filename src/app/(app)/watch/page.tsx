import { PageHeader } from "@/components/ui";
import { WatchSection } from "@/components/watch-section";
import { requireSession } from "@/lib/session";
import { describeSchedule, cronFor } from "@/lib/job-runs";
import { FRESH_MINUTES, openFindings, sweepIfStale } from "@/lib/watch";

export const metadata = { title: "Tally Watch · CannaTrace" };

/** Everything Tally Watch has found at this facility, with one-click fixes. */
export default async function WatchPage() {
  const session = await requireSession();
  await sweepIfStale(session);
  const findings = await openFindings(session);
  return (
    <>
      <PageHeader
        title="Tally Watch"
        subtitle={`Tally checks the business ${describeSchedule(cronFor("watch"))}, and again whenever someone opens this page or the dashboard (at most every ${FRESH_MINUTES} minutes). You approve every fix, and every fix can be undone.`}
      />
      <WatchSection session={session} findings={findings} />
    </>
  );
}
