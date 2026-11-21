import * as Sentry from "@sentry/nextjs";

/** Start crash alerts for whichever runtime this server is. Does nothing until NEXT_PUBLIC_SENTRY_DSN is set. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

/** Any error a page, server action, proxy or API route throws on the server is reported. */
export const onRequestError = Sentry.captureRequestError;
