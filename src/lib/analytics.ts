import { inject } from "@vercel/analytics";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function shouldEnableAnalytics(isProd: boolean, hostname: string | undefined): boolean {
  if (!isProd || !hostname) return false;
  return !LOCAL_HOSTS.has(hostname.toLowerCase());
}

/**
 * Enables first-party Vercel Web Analytics (/_vercel/insights/*) on deployed
 * hosts while staying silent on local dev/preview/E2E loopback servers.
 */
export function initAnalytics(): void {
  if (typeof window === "undefined") return;
  if (shouldEnableAnalytics(import.meta.env.PROD, window.location?.hostname)) {
    inject({ mode: "production" });
  }
}
