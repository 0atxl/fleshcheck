import { canvasToPngBlob } from "../lib/export-png";

export type NativeShareOutcome = "shared" | "cancelled" | "unsupported" | "failed";

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

export function isNativeShareAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Invokes the platform native share sheet with the rendered evidence PNG when
 * file sharing is supported, falling back to text-only native share otherwise.
 */
export async function shareEvidenceCard(
  canvas: HTMLCanvasElement,
  shareText: string,
  filename: string,
): Promise<NativeShareOutcome> {
  if (!isNativeShareAvailable()) {
    return "unsupported";
  }

  try {
    const blob = await canvasToPngBlob(canvas);
    if (typeof File !== "undefined") {
      const file = new File([blob], filename, { type: "image/png" });
      const filePayload: ShareData = {
        files: [file],
        title: "fleshcheck",
        text: shareText,
      };
      if (typeof navigator.canShare === "function" && navigator.canShare(filePayload)) {
        await navigator.share(filePayload);
        return "shared";
      }
    }

    await navigator.share({
      title: "fleshcheck",
      text: shareText,
    });
    return "shared";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return "cancelled";
    }
    return "failed";
  }
}
