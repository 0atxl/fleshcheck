const CLIP_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

const VIDEO_BITS_PER_SECOND = 1_500_000;

export interface RecordedClip {
  blob: Blob;
  ext: "mp4" | "webm";
  mimeType: string;
}

/**
 * Picks the first supported MediaRecorder MIME type from the prioritized list.
 */
export function pickSupportedClipMime(
  recorderCtor: { isTypeSupported?: (type: string) => boolean } | undefined =
    typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined,
): string | null {
  if (!recorderCtor || typeof recorderCtor.isTypeSupported !== "function") {
    return null;
  }
  for (const mime of CLIP_MIME_CANDIDATES) {
    try {
      if (recorderCtor.isTypeSupported(mime)) {
        return mime;
      }
    } catch {
      // Ignore probe failure
    }
  }
  return null;
}

export function clipExtensionForMime(mimeType: string): "mp4" | "webm" {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

/**
 * Records an entire active round from chunk #0 to verdict so MP4/WebM container
 * headers remain valid across every recorded clip.
 */
export class RoundClipRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private mimeType: string | null = null;
  private stopPromise: Promise<RecordedClip | null> | null = null;

  start(canvas: HTMLCanvasElement): boolean {
    this.abort();
    const mime = pickSupportedClipMime();
    if (!mime || typeof canvas.captureStream !== "function") {
      return false;
    }

    try {
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });

      this.stream = stream;
      this.recorder = recorder;
      this.mimeType = mime;
      this.chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.stopPromise = new Promise<RecordedClip | null>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          const usedMime = this.mimeType ?? mime;
          const recordedChunks = this.chunks;
          this.releaseStream();
          this.recorder = null;
          this.chunks = [];
          if (recordedChunks.length === 0) {
            resolve(null);
            return;
          }
          const blob = new Blob(recordedChunks, { type: usedMime });
          if (blob.size <= 0) {
            resolve(null);
            return;
          }
          resolve({
            blob,
            ext: clipExtensionForMime(usedMime),
            mimeType: usedMime,
          });
        };

        recorder.onstop = finish;
        recorder.onerror = () => {
          this.chunks = [];
          finish();
        };
      });

      recorder.start(250);
      return true;
    } catch {
      this.abort();
      return false;
    }
  }

  async stop(): Promise<RecordedClip | null> {
    const rec = this.recorder;
    const pending = this.stopPromise;
    if (!rec || !pending) {
      this.releaseStream();
      return null;
    }

    if (rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        this.releaseStream();
        return null;
      }
    }

    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timeoutId = globalThis.setTimeout(() => {
        this.abort();
        resolve(null);
      }, 1_500);
    });

    try {
      return await Promise.race([pending, timedOut]);
    } finally {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  }

  abort(): void {
    const rec = this.recorder;
    this.recorder = null;
    this.stopPromise = null;
    this.chunks = [];
    this.mimeType = null;
    if (rec && rec.state !== "inactive") {
      try {
        rec.onstop = null;
        rec.onerror = null;
        rec.stop();
      } catch {
        // Ignore stop errors during teardown
      }
    }
    this.releaseStream();
  }

  private releaseStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }
}
