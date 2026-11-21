"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last resort when even the app's frame fails to load. Reports the crash and offers a way back. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f8fafc" }}>
        <main style={{ maxWidth: 420, textAlign: "center", padding: 24 }} role="alert">
          <h1 style={{ fontSize: 22, color: "#0f172a" }}>CannaTrace didn&apos;t load</h1>
          <p style={{ color: "#475569" }}>Nothing you saved was lost. We&apos;ve been told about this. Try again in a moment.</p>
          <button type="button" onClick={() => retry()} style={{ minHeight: 44, padding: "0 20px", borderRadius: 8, border: 0, background: "#15803d", color: "white", fontWeight: 600 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
