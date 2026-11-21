/**
 * Crash alerts (Sentry). Shared by the server, edge and browser setups.
 *
 * Off unless a DSN is set in Vercel (NEXT_PUBLIC_SENTRY_DSN), so local work and tests send nothing.
 * Stores trust us with customer ID details, sales and inventory, so reports carry only what is
 * needed to find the bug: the error, the stack and the page path. No cookies, no form data,
 * no request bodies, no IP addresses, no query strings, and no screen recordings.
 */
import type { ErrorEvent } from "@sentry/nextjs";

export const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;

/** Strip anything that could identify a customer or a store's data before a report leaves the app. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  for (const crumb of event.breadcrumbs ?? []) {
    // Page changes and network calls: keep the path, drop the query (it can hold a name or a search).
    for (const key of ["url", "from", "to"]) {
      const v = crumb.data?.[key];
      if (typeof v === "string") crumb.data![key] = v.split("?")[0];
    }
    // Typed input and console output can hold anything an employee typed or the app logged.
    if (crumb.category === "ui.input" || crumb.category === "console") {
      crumb.message = undefined;
      if (crumb.data) delete crumb.data.arguments;
    }
  }
  return event;
}

export const sentryOptions = {
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  // Errors only: no performance tracing, which keeps us well inside Sentry's free plan.
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
};
