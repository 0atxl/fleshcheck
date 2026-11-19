import { mulberry32, shuffleWithRng } from "../prng";
import type { Challenge, ChallengeContext, ChallengeResult, FaceSignal, Viewport } from "../types";

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
    this.seed = ctx.seed;

    const count = this.durationMs <= 5_000 ? 2 : 4;
    this.slotDurationMs = this.durationMs / count;

    const rng = mulberry32(ctx.seed);
    const allPrompts = ctx.copy.prompts ?? ["Mild disappointment", "Performative surprise", "Raised eyebrow", "Inflated cheeks"];
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
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const prompt = this.getCurrentPrompt();
    const holdRatio = Math.min(1, this.holdMs / HOLD_REQUIRED_MS);
    const isHolding = holdRatio > 0;
    const slotRemaining = Math.max(0, (this.slotDurationMs - this.slotElapsedMs) / 1000).toFixed(1);

    ctx.save();

    // Top HUD
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(0, 0, vp.width, 44);
    ctx.fillStyle =
      this.status === "failed" ? "#C92A2A" : this.lockFlashMs > 0 ? "#51CF66" : "#E8590C";
    ctx.fillRect(0, 40, vp.width * progress, 4);

    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#F6F7F4";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(
      `FORM 33-E · EXPRESSION STANDARDS (${this.matchedCount}/${this.promptQueue.length})`,
      16,
      20,
    );

    ctx.textAlign = "right";
    ctx.fillText(`${slotRemaining}s`, vp.width - 16, 20);

    // Prompt placard at bottom
    if (prompt) {
      const margin = 16;
      const boxW = vp.width - margin * 2;
      const boxH = 88;
      const boxY = vp.height - boxH - margin;

      ctx.fillStyle = "rgba(26, 29, 30, 0.9)";
      ctx.fillRect(margin, boxY, boxW, boxH);
      ctx.strokeStyle =
        this.lockFlashMs > 0 || isHolding
          ? "#51CF66"
          : this.proximity > 0.35
            ? "#E8590C"
            : "rgba(246, 247, 244, 0.3)";
      ctx.lineWidth = 2;
      ctx.strokeRect(margin + 1, boxY + 1, boxW - 2, boxH - 2);

      ctx.fillStyle = isHolding ? "#51CF66" : "#D4D8DA";
      ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        isHolding
          ? `HOLD EXPRESSION · PROMPT ${this.matchedCount + 1}`
          : `DEMONSTRATE PROMPT ${this.matchedCount + 1}`,
        vp.width / 2,
        boxY + 20,
      );

      ctx.fillStyle = "#F6F7F4";
      ctx.font = "700 20px system-ui, -apple-system, sans-serif";
      ctx.fillText(prompt, vp.width / 2, boxY + 46, boxW - 32);

      // Dual-stage meter: amber live proximity before threshold, green hold-lock once matched
      const barW = Math.min(240, boxW - 48);
      const barX = (vp.width - barW) / 2;
      ctx.fillStyle = "rgba(246, 247, 244, 0.2)";
      ctx.fillRect(barX, boxY + 68, barW, 8);
      if (isHolding) {
        ctx.fillStyle = "#51CF66";
        ctx.fillRect(barX, boxY + 68, barW * holdRatio, 8);
      } else {
        ctx.fillStyle = "#E8590C";
        ctx.fillRect(barX, boxY + 68, barW * this.proximity, 8);
      }
    }

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const total = Math.max(1, this.promptQueue.length);
    const progress = this.status === "passed" ? 1 : Math.min(0.99, this.matchedCount / total);
    const res: ChallengeResult = {
      status: this.status,
      progress,
      milestones: this.matchedCount,
    };
    if (this.callout !== undefined) {
      res.callout = this.callout;
    }
    return res;
  }
}
