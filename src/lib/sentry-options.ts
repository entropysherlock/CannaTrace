/**
 * Crash alerts (Sentry). Shared by the server, edge and browser setups.
 *
 * Off unless a DSN is set in Vercel (NEXT_PUBLIC_SENTRY_DSN), so local work and tests send nothing.
 * Stores trust us with customer ID details, sales and inventory, so reports carry only what is
 * needed to find the bug: the error, the stack and the page path. No cookies, no form data,
 * no request bodies, no IP addresses, no query strings, no local variable values, no database
 * query data, and no screen recordings.
 */
import type { ErrorEvent, init } from "@sentry/nextjs";

type InitOptions = NonNullable<Parameters<typeof init>[0]>;
type TransactionEvent = Parameters<NonNullable<InitOptions["beforeSendTransaction"]>>[0];
type SpanJSON = Parameters<NonNullable<InitOptions["beforeSendSpan"]>>[0];

const URL_KEYS = ["url", "url.full", "http.url", "http.target"];
const DROP_KEYS = ["url.query", "http.query", "client.address", "http.client_ip", "net.sock.peer.addr"];

/**
 * Performance spans (Sentry streams these one by one): keep paths and timings, drop query strings and
 * the visitor's IP address.
 */
export function scrubSpan(span: SpanJSON): SpanJSON {
  const attrs = span.attributes as Record<string, unknown>;
  for (const key of URL_KEYS) {
    const v = attrs[key];
    if (typeof v === "string") attrs[key] = v.split("?")[0];
  }
  for (const key of DROP_KEYS) delete attrs[key];
  span.name = span.name.split("?")[0];
  return span;
}

export const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;

/** Strip anything that could identify a customer or a store's data before a report leaves the app. */
export function scrubEvent<E extends ErrorEvent | TransactionEvent>(event: E): E {
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
  // Performance traces: span URLs keep their path only.
  for (const span of (event as TransactionEvent).spans ?? []) {
    if (!span.data) continue;
    for (const key of ["url", "http.url", "url.full", "http.target"]) {
      const v = span.data[key];
      if (typeof v === "string") span.data[key] = v.split("?")[0];
    }
    delete span.data["http.query"];
    delete span.data["url.query"];
  }
  if (event.transaction) event.transaction = event.transaction.split("?")[0];
  return event;
}

const isDev = process.env.NODE_ENV === "development";

export const sentryOptions = {
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  // Sentry's recommended default: trace every request while developing, 1 in 10 in production.
  tracesSampleRate: isDev ? 1.0 : 0.1,
  // Collect nothing beyond the error itself. Local variables in stack frames and database query data are
  // on by default in Sentry and could hold a customer's name, birth date or ID number, so they are off.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
  },
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeSendSpan: scrubSpan,
};
