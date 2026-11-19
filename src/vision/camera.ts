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
    // Initiate playback before waiting for decoded frames so detached <video>
    // elements start decoding promptly on iOS Safari / mobile WebKit.
    const playPromise = video.play().catch((err) => {
      // Autoplay rejections on muted inline streams are rare, but surface real playback failure
      return Promise.reject(err);
    });
    await Promise.all([waitForVideoFrame(video), playPromise.catch(() => {})]);
    if (video.paused) {
      await video.play();
    }
    return { ok: true, stream, video };
  } catch {
    stopCamera(stream, video);
    return { ok: false, reason: "error", inAppWebView };
  }
}

const HAVE_CURRENT_DATA = 2;

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("Camera frame timeout"));
    }, 8_000);

    const onLoaded = () => {
      if (video.videoWidth > 0 && video.readyState >= HAVE_CURRENT_DATA) {
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video stream error"));
    };
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("playing", onLoaded);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadedmetadata", onLoaded);
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
