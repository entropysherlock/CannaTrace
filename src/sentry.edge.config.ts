// Crash alerts on the edge runtime (proxy and edge routes). Loaded by src/instrumentation.ts.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

Sentry.init(sentryOptions);
