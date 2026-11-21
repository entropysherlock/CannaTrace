import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

/** Crash alerts in the browser: errors on an employee's screen reach us, scrubbed of store data. */
try {
  Sentry.init(sentryOptions);
} catch {
  // Monitoring must never stop the app from loading.
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
