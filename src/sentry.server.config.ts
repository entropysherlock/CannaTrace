// Crash alerts on the Node.js server. Loaded by src/instrumentation.ts.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

Sentry.init(sentryOptions);
