import { describe, expect, it } from "vitest";
import { clipExtensionForMime, pickSupportedClipMime } from "../src/output/clip";

describe("fail clip MIME selection", () => {
  it("prioritizes MP4 H.264 before WebM VP9/VP8", () => {
    const allSupported = { isTypeSupported: () => true };
    expect(pickSupportedClipMime(allSupported)).toBe("video/mp4;codecs=avc1.640028");

    const webmOnly = {
      isTypeSupported: (mime: string) => mime.startsWith("video/webm"),
    };
    expect(pickSupportedClipMime(webmOnly)).toBe("video/webm;codecs=vp9");

    const vp8Only = {
      isTypeSupported: (mime: string) => mime === "video/webm;codecs=vp8",
    };
    expect(pickSupportedClipMime(vp8Only)).toBe("video/webm;codecs=vp8");

    const none = { isTypeSupported: () => false };
    expect(pickSupportedClipMime(none)).toBeNull();
    expect(pickSupportedClipMime(undefined)).toBeNull();
  });

  it("maps MIME types to mp4 or webm file extensions", () => {
    expect(clipExtensionForMime("video/mp4;codecs=avc1.640028")).toBe("mp4");
    expect(clipExtensionForMime("video/mp4")).toBe("mp4");
    expect(clipExtensionForMime("video/webm;codecs=vp9")).toBe("webm");
  });
});
