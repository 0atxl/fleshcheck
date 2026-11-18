import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import faceModelUrl from "../assets/face_landmarker.task?url";

interface NetworkInfoLike {
  saveData?: boolean;
}

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInfoLike;
};

let prefetched = false;

/**
 * Warms the browser HTTP cache with WASM and model bytes ahead of execution.
 * Respects Chromium's Data Saver signal when present.
 */
export function prefetchFaceAssets(): void {
  if (prefetched) return;
  if (typeof navigator !== "undefined") {
    const conn = (navigator as NavigatorWithConnection).connection;
    if (conn?.saveData === true) return;
  }
  prefetched = true;

  for (const url of [wasmLoaderPath, wasmBinaryPath, faceModelUrl]) {
    fetch(url, { priority: "low" } as RequestInit)
      .then((res) => (res.ok ? res.arrayBuffer() : undefined))
      .catch(() => {});
  }
}

/**
 * Dynamically imports MediaPipe vision and creates a VIDEO-mode FaceLandmarker.
 * Attempts GPU acceleration first and falls back cleanly to CPU.
 */
export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  const { FaceLandmarker: FL } = await import("@mediapipe/tasks-vision");
  const fileset = { wasmLoaderPath, wasmBinaryPath };
  const makeOptions = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: faceModelUrl, delegate },
    runningMode: "VIDEO" as const,
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });

  try {
    return await FL.createFromOptions(fileset, makeOptions("GPU"));
  } catch {
    return await FL.createFromOptions(fileset, makeOptions("CPU"));
  }
}
