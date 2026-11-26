import { describe, expect, it } from "vitest";
import config, { SECURITY_HEADERS } from "../next.config";

const value = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe("security headers", () => {
  it("are sent on every path", async () => {
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers).toEqual(SECURITY_HEADERS);
  });

  it("stop other sites embedding the app and sniffing content types", () => {
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(value("X-Content-Type-Options")).toBe("nosniff");
  });

  it("keep the camera for this site (scanning) and turn off the microphone and location", () => {
    const policy = value("Permissions-Policy") ?? "";
    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
  });

  it("require https for a year without touching subdomains", () => {
    const hsts = value("Strict-Transport-Security") ?? "";
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).not.toContain("includeSubDomains");
  });
});
