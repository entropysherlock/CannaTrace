import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

/** Start crash alerts on the server (Node and edge). Does nothing until NEXT_PUBLIC_SENTRY_DSN is set. */
export function register() {
  Sentry.init(sentryOptions);
}

/** Any error a page, server action or API route throws on the server is reported. */
export const onRequestError = Sentry.captureRequestError;
