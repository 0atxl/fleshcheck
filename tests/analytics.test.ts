import { describe, expect, it } from "vitest";
import { shouldEnableAnalytics } from "../src/lib/analytics";

describe("Vercel Web Analytics gate", () => {
  it("enables analytics in production builds on deployed hosts", () => {
    expect(shouldEnableAnalytics(true, "fleshcheck.vercel.app")).toBe(true);
    expect(shouldEnableAnalytics(true, "fleshcheck-git-main.vercel.app")).toBe(true);
    expect(shouldEnableAnalytics(true, "fleshcheck.example")).toBe(true);
  });

  it("stays disabled in development or on local loopback hosts", () => {
    expect(shouldEnableAnalytics(false, "fleshcheck.vercel.app")).toBe(false);
    expect(shouldEnableAnalytics(true, "localhost")).toBe(false);
    expect(shouldEnableAnalytics(true, "LOCALHOST")).toBe(false);
    expect(shouldEnableAnalytics(true, "127.0.0.1")).toBe(false);
    expect(shouldEnableAnalytics(true, "::1")).toBe(false);
    expect(shouldEnableAnalytics(true, "[::1]")).toBe(false);
    expect(shouldEnableAnalytics(true, "")).toBe(false);
    expect(shouldEnableAnalytics(true, undefined)).toBe(false);
  });
});
