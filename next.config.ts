import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * Headers sent on every response. Chosen to be safe for this app as it works today: no page is embedded in
 * another site, the camera is used for scanning (so it stays allowed for this site only), and nothing uses
 * the microphone or location. A full Content-Security-Policy needs per-request nonces and testing against the
 * scanner, Sentry and the service worker, so it is a separate piece of work.
 */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  /* config options here */
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
