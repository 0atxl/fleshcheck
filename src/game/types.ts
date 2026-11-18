export type ChallengeId =
  | "POKER_FACE"
  | "NOSE_SPOON"
  | "BOT_DODGE"
  | "PASSPORT_PHOTO"
  | "MOUTH_CATCH"
  | "AFFECT_DEMO"
  | "INTERVIEW"
  | "NOSE_CURSOR"
  | "EYES_ON_FORM"
  | "FULL_AUDIT"
  | "FINGER_COUNT"
  | "WIRE_UNTANGLE";

export interface Point2D {
  x: number;
  y: number;
}

export interface Rect2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Baseline {
  shapes: Record<string, number>;
  nose: Point2D;
  rollRad: number;
  yawRad: number;
  pitchRad: number;
}

export interface CopyBank {
  taunts?: readonly string[];
  callouts: readonly string[];
  commentary?: readonly string[];
  rules?: readonly string[];
  forms?: readonly string[];
  prompts?: readonly string[];
  judgements?: readonly string[];
  questions?: readonly { text: string; answer: "yes" | "no" | "either" }[];
  checkboxes?: readonly { label: string; trap: boolean }[];
  popups?: readonly string[];
  transitions?: readonly string[];
}

export interface FaceSignal {
  t: number;
  tracked: boolean;
  shapes: Record<string, number>;
  delta: Record<string, number>;
  nose: Point2D;
  mouth: Point2D;
  faceBox: Rect2D;
  pose: HeadPose;
  landmarks: Point2D[];
}

export interface TryRecord {
  passed: boolean;
  pct: number;
  paused: boolean;
}

export interface ChallengeResult {
  status: "running" | "failed" | "passed";
  progress: number;
  callout?: string;
  roundRecords?: TryRecord[];
}

export interface ChallengeContext {
  seed: number;
  baseline: Baseline;
  copy: CopyBank;
  viewport: Viewport;
  durationMs: number;
}

export interface Challenge<S = FaceSignal> {
  init(ctx: ChallengeContext): void;
  update(dtMs: number, signal: S): void;
  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void;
  getResult(): ChallengeResult;
}

export interface ChallengeManifest {
  id: ChallengeId;
  title: string;
  department: string;
  prompt: string;
  model: "face" | "hands";
  durationMs: number;
  maxTries?: number;
  enabled: boolean;
  copy: CopyBank;
  create: () => Challenge;
}
