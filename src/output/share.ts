export function buildChallengeLink(dayNumber: number, pct: number): string {
  if (typeof window === "undefined") {
    return `?day=${dayNumber}&vs=${pct}`;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("day", String(dayNumber));
  url.searchParams.set("vs", String(pct));
  return url.toString();
}

export function buildXIntentUrl(shareText: string): string {
  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set("text", shareText);
  return url.toString();
}
