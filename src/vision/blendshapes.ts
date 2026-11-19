/**
 * Exact 52 blendshape category names emitted by MediaPipe's shipped
 * face_landmarker.task (face_blendshapes.tflite). Note that ARKit's
 * `tongueOut` is intentionally absent from MediaPipe's 52-category model.
 */
export const MEDIAPIPE_BLENDSHAPES = [
  "_neutral",
  "browDownLeft",
  "browDownRight",
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight",
  "cheekPuff",
  "cheekSquintLeft",
  "cheekSquintRight",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "eyeLookDownLeft",
  "eyeLookDownRight",
  "eyeLookInLeft",
  "eyeLookInRight",
  "eyeLookOutLeft",
  "eyeLookOutRight",
  "eyeLookUpLeft",
  "eyeLookUpRight",
  "eyeSquintLeft",
  "eyeSquintRight",
  "eyeWideLeft",
  "eyeWideRight",
  "jawForward",
  "jawLeft",
  "jawOpen",
  "jawRight",
  "mouthClose",
  "mouthDimpleLeft",
  "mouthDimpleRight",
  "mouthFrownLeft",
  "mouthFrownRight",
  "mouthFunnel",
  "mouthLeft",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthPucker",
  "mouthRight",
  "mouthRollLower",
  "mouthRollUpper",
  "mouthShrugLower",
  "mouthShrugUpper",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
  "noseSneerLeft",
  "noseSneerRight",
] as const;

export type BlendshapeName = (typeof MEDIAPIPE_BLENDSHAPES)[number];
export type BlendshapeMap = Partial<Record<BlendshapeName, number>>;

const BLENDSHAPE_SET: ReadonlySet<string> = new Set(MEDIAPIPE_BLENDSHAPES);

export function isBlendshapeName(name: string): name is BlendshapeName {
  return BLENDSHAPE_SET.has(name);
}
