import { mulberry32, shuffleWithRng } from "../prng";
import { THEME } from "../theme";
import type {
  Challenge,
  ChallengeContext,
  ChallengeResult,
  EvidenceMark,
  FaceSignal,
  Rect2D,
  Viewport,
} from "../types";
import { clampEvidenceRect, drawProgressLine, drawPromptStrip, drawTimerTag } from "./hud";

const HOLD_REQUIRED_MS = 350;
const FLASH_DURATION_MS = 220;

function ratio(val: number | undefined, threshold: number): number {
  if (!val || val <= 0 || threshold <= 0) return 0;
  return val / threshold;
}

/**
 * Returns normalized proximity [0..1] toward satisfying an expression recipe.
 * A value of 1 means the expression threshold is currently met.
 */
export function computeAffectProximity(label: string, signal: FaceSignal): number {
  const d = signal.delta;
  let score = 0;

  switch (label) {
    case "Mild disappointment":
      score = Math.max(
        ratio(((d.mouthFrownLeft ?? 0) + (d.mouthFrownRight ?? 0)) / 2, 0.12),
        ratio(((d.mouthPressLeft ?? 0) + (d.mouthPressRight ?? 0)) / 2, 0.16),
      );
      break;
    case "Performative surprise":
      score = Math.max(
        Math.min(
          ratio(((d.eyeWideLeft ?? 0) + (d.eyeWideRight ?? 0)) / 2, 0.14),
          ratio(d.jawOpen, 0.12),
        ),
        ratio(d.browInnerUp, 0.22),
      );
      break;
    case "Raised eyebrow":
      score = ratio(Math.max(d.browOuterUpLeft ?? 0, d.browOuterUpRight ?? 0), 0.18);
      break;
    case "Sideways jaw":
      score = ratio(Math.max(d.jawLeft ?? 0, d.jawRight ?? 0), 0.16);
      break;
    case "Regulated smile":
      score = ratio(((d.mouthSmileLeft ?? 0) + (d.mouthSmileRight ?? 0)) / 2, 0.22);
      break;
    case "Bureaucratic suspicion":
      score = Math.max(
        ratio(((d.eyeSquintLeft ?? 0) + (d.eyeSquintRight ?? 0)) / 2, 0.16),
        ratio(((d.browDownLeft ?? 0) + (d.browDownRight ?? 0)) / 2, 0.16),
      );
      break;
    case "Inflated cheeks":
      score = ratio(d.cheekPuff, 0.20);
      break;
    case "Silent yawn":
      score = ratio(d.jawOpen, 0.26);
      break;
    case "Polite disapproval":
      score = Math.max(
        ratio(d.mouthPucker, 0.20),
        ratio(((d.noseSneerLeft ?? 0) + (d.noseSneerRight ?? 0)) / 2, 0.14),
      );
      break;
    case "Sudden realization":
      score = Math.min(ratio(d.browInnerUp, 0.18), ratio(d.jawOpen, 0.10));
      break;
    case "Skeptical scowl":
      score = ratio(((d.browDownLeft ?? 0) + (d.browDownRight ?? 0)) / 2, 0.16);
      break;
    case "Subtle whistle":
      score = Math.max(ratio(d.mouthPucker, 0.20), ratio(d.mouthFunnel, 0.18));
      break;
    default:
      score = 0;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Evaluates whether a FaceSignal satisfies one of the 12 expression recipes.
 */
export function matchesAffectPrompt(label: string, signal: FaceSignal): boolean {
  return computeAffectProximity(label, signal) >= 1;
}

/**
 * Expression Standards challenge: perform prompted facial expressions before each window closes.
 */
export class AffectDemoChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private slotDurationMs = 3_000;
  private slotElapsedMs = 0;
  private holdMs = 0;
  private proximity = 0;
  private lockFlashMs = 0;
  private matchedCount = 0;
  private promptQueue: string[] = [];
  private calloutPool: readonly string[] = ["INSUFFICIENT DISAPPOINTMENT"];
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private evidence: EvidenceMark | undefined;
  private viewport: Viewport = { width: 640, height: 480 };
  private lastFaceBox: Rect2D = { x: 0, y: 0, w: 0, h: 0 };
  private seed = 1;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.slotElapsedMs = 0;
    this.holdMs = 0;
    this.proximity = 0;
    this.lockFlashMs = 0;
    this.matchedCount = 0;
    this.status = "running";
    this.callout = undefined;
    this.evidence = undefined;
    this.viewport = { ...ctx.viewport };
    this.lastFaceBox = { x: 0, y: 0, w: 0, h: 0 };
    this.seed = ctx.seed;

    const count = this.durationMs <= 5_000 ? 2 : 4;
    this.slotDurationMs = this.durationMs / count;

    const rng = mulberry32(ctx.seed);
    const allPrompts = ctx.copy.prompts ?? [
      "Mild disappointment",
      "Performative surprise",
      "Raised eyebrow",
      "Inflated cheeks",
    ];
    this.promptQueue = shuffleWithRng(allPrompts, rng).slice(0, count);

    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }
  }

  getCurrentPrompt(): string {
    return this.promptQueue[this.matchedCount] ?? "";
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    this.elapsedMs += clampedDt;
    this.slotElapsedMs += clampedDt;
    this.lastFaceBox = signal.faceBox;
    if (this.lockFlashMs > 0) {
      this.lockFlashMs = Math.max(0, this.lockFlashMs - clampedDt);
    }

    const currentPrompt = this.promptQueue[this.matchedCount];
    if (!currentPrompt) {
      this.status = "passed";
      return;
    }

    this.proximity = computeAffectProximity(currentPrompt, signal);

    if (this.proximity >= 1) {
      this.holdMs += clampedDt;
      if (this.holdMs >= HOLD_REQUIRED_MS) {
        this.matchedCount += 1;
        this.holdMs = 0;
        this.proximity = 0;
        this.slotElapsedMs = 0;
        this.lockFlashMs = FLASH_DURATION_MS;
        if (this.matchedCount >= this.promptQueue.length) {
          this.status = "passed";
          return;
        }
      }
    } else {
      this.holdMs = Math.max(0, this.holdMs - clampedDt);
    }

    if (this.slotElapsedMs >= this.slotDurationMs) {
      this.status = "failed";
      const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
      this.callout =
        this.calloutPool[Math.floor(rng() * this.calloutPool.length)] ?? "EXPRESSION UNCONVINCING";
      const fallback: Rect2D = {
        x: this.viewport.width * 0.28,
        y: this.viewport.height * 0.2,
        w: this.viewport.width * 0.44,
        h: this.viewport.height * 0.5,
      };
      const rect = this.lastFaceBox.w > 0 && this.lastFaceBox.h > 0 ? this.lastFaceBox : fallback;
      this.evidence = {
        rect: clampEvidenceRect(rect, this.viewport, 80, 90),
        label: `Missed: ${currentPrompt.toLowerCase()}`,
      };
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.viewport = { ...vp };
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const prompt = this.getCurrentPrompt();
    const holdRatio = Math.min(1, this.holdMs / HOLD_REQUIRED_MS);
    const isHolding = holdRatio > 0;

    ctx.save();

    drawProgressLine(ctx, vp, progress, {
      danger: this.status === "failed",
      accent: this.lockFlashMs > 0 || isHolding ? THEME.stampBlue : THEME.paper,
    });
    drawTimerTag(ctx, vp, Math.max(0, this.slotDurationMs - this.slotElapsedMs), {
      counter: `${this.matchedCount}/${this.promptQueue.length}`,
    });

    if (prompt) {
      drawPromptStrip(ctx, vp, prompt, {
        label: isHolding
          ? `HOLD EXPRESSION · PROMPT ${this.matchedCount + 1}`
          : `DEMONSTRATE · PROMPT ${this.matchedCount + 1} OF ${this.promptQueue.length}`,
        labelColor: isHolding ? THEME.stampBlue : THEME.formBlue,
        borderAccent:
          this.status === "failed"
            ? THEME.stampRed
            : this.lockFlashMs > 0 || isHolding
              ? THEME.stampBlue
              : THEME.ink,
        meter: {
          fraction: isHolding ? holdRatio : this.proximity,
          color: isHolding ? THEME.stampBlue : THEME.formBlue,
        },
        maxLines: 2,
      });
    }

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const total = Math.max(1, this.promptQueue.length);
    const progress = this.status === "passed" ? 1 : Math.min(0.99, this.matchedCount / total);
    return {
      status: this.status,
      progress,
      milestones: this.matchedCount,
      ...(this.callout !== undefined ? { callout: this.callout } : {}),
      ...(this.evidence !== undefined ? { evidence: this.evidence } : {}),
    };
  }
}
