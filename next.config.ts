import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // COA uploads (PDF or image) go through a Server Action.
    serverActions: { bodySizeLimit: "5mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

/**
 * Readable stack traces in crash alerts: upload source maps to Sentry at build time, then delete them so
 * they are never served publicly. Only when SENTRY_AUTH_TOKEN (plus SENTRY_ORG and SENTRY_PROJECT) is set
 * in Vercel; without it the build is exactly as before.
 */
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      telemetry: false,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
