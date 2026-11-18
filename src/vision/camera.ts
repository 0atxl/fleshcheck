export type CameraFailureReason = "denied" | "no-hardware" | "webview-blocked" | "error";

export interface CameraResult {
  ok: true;
  stream: MediaStream;
  video: HTMLVideoElement;
}

export interface CameraError {
  ok: false;
  reason: CameraFailureReason;
  inAppWebView: boolean;
}

export function isLikelyInAppWebView(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  return /(FBAN|FBAV|Instagram|Twitter|X-Client|TikTok|BytedanceWebview|Line\/|MicroMessenger|Snapchat|LinkedInApp|wv\b)/i.test(
    ua,
  );
}

/**
 * Requests user-facing camera video at landscape ideal dimensions to avoid
 * mobile Safari/Android orientation stream rotation bugs.
 */
export async function requestCamera(videoEl?: HTMLVideoElement): Promise<CameraResult | CameraError> {
  const inAppWebView = isLikelyInAppWebView();

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      reason: inAppWebView ? "webview-blocked" : "no-hardware",
      inAppWebView,
    };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return {
        ok: false,
        reason: inAppWebView ? "webview-blocked" : "denied",
        inAppWebView,
      };
    }
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
      return { ok: false, reason: "no-hardware", inAppWebView };
    }
    return { ok: false, reason: "error", inAppWebView };
  }

  const video = videoEl ?? document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;

  try {
    await waitForVideoFrame(video);
    await video.play().catch(() => {});
    return { ok: true, stream, video };
  } catch {
    stopCamera(stream, video);
    return { ok: false, reason: "error", inAppWebView };
  }
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Camera frame timeout"));
    }, 8_000);

    const onLoaded = () => {
      if (video.videoWidth > 0) {
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video stream error"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("playing", onLoaded);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("playing", onLoaded);
    video.addEventListener("error", onError);
  });
}

/**
 * Stops media tracks and releases temporary WebKit canvas backing stores.
 */
export function stopCamera(
  stream: MediaStream | null | undefined,
  video?: HTMLVideoElement | null,
  tempCanvases: HTMLCanvasElement[] = [],
): void {
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  if (video) {
    const src = video.srcObject;
    if (src && "getTracks" in src) {
      for (const track of src.getTracks()) {
        track.stop();
      }
    }
    video.srcObject = null;
  }
  for (const canvas of tempCanvases) {
    canvas.width = 0;
    canvas.height = 0;
  }
}
