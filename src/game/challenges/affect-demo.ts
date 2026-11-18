import { mulberry32, shuffleWithRng } from "../prng";
import type { Challenge, ChallengeContext, ChallengeResult, FaceSignal, Viewport } from "../types";

const HOLD_REQUIRED_MS = 350;

/**
 * Evaluates whether a FaceSignal satisfies one of the 12 expression recipes.
 */
export function matchesAffectPrompt(label: string, signal: FaceSignal): boolean {
  const d = signal.delta;
  const s = signal.shapes;

  switch (label) {
    case "Mild disappointment":
      return ((d.mouthFrownLeft ?? 0) + (d.mouthFrownRight ?? 0)) / 2 > 0.12 ||
        ((d.mouthPressLeft ?? 0) + (d.mouthPressRight ?? 0)) / 2 > 0.16;
    case "Performative surprise":
      return (((d.eyeWideLeft ?? 0) + (d.eyeWideRight ?? 0)) / 2 > 0.14 && (d.jawOpen ?? 0) > 0.12) ||
        (d.browInnerUp ?? 0) > 0.22;
    case "Raised eyebrow":
      return Math.max(d.browOuterUpLeft ?? 0, d.browOuterUpRight ?? 0) > 0.18;
    case "Visible tongue":
      return (s.tongueOut ?? 0) > 0.22 || (d.tongueOut ?? 0) > 0.20;
    case "Regulated smile":
      return ((d.mouthSmileLeft ?? 0) + (d.mouthSmileRight ?? 0)) / 2 > 0.22;
    case "Bureaucratic suspicion":
      return ((d.eyeSquintLeft ?? 0) + (d.eyeSquintRight ?? 0)) / 2 > 0.16 ||
        ((d.browDownLeft ?? 0) + (d.browDownRight ?? 0)) / 2 > 0.16;
    case "Inflated cheeks":
      return (d.cheekPuff ?? 0) > 0.20;
    case "Silent yawn":
      return (d.jawOpen ?? 0) > 0.26;
    case "Polite disapproval":
      return (d.mouthPucker ?? 0) > 0.20 ||
        ((d.noseSneerLeft ?? 0) + (d.noseSneerRight ?? 0)) / 2 > 0.14;
    case "Sudden realization":
      return (d.browInnerUp ?? 0) > 0.18 && (d.jawOpen ?? 0) > 0.10;
    case "Skeptical scowl":
      return ((d.browDownLeft ?? 0) + (d.browDownRight ?? 0)) / 2 > 0.16;
    case "Subtle whistle":
      return (d.mouthPucker ?? 0) > 0.20 || (d.mouthFunnel ?? 0) > 0.18;
    default:
      return false;
  }
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

    const currentPrompt = this.promptQueue[this.matchedCount];
    if (!currentPrompt) {
      this.status = "passed";
      return;
    }

    if (matchesAffectPrompt(currentPrompt, signal)) {
      this.holdMs += clampedDt;
      if (this.holdMs >= HOLD_REQUIRED_MS) {
        this.matchedCount += 1;
        this.holdMs = 0;
        this.slotElapsedMs = 0;
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
    const slotRemaining = Math.max(0, (this.slotDurationMs - this.slotElapsedMs) / 1000).toFixed(1);

    ctx.save();

    // Top HUD
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(0, 0, vp.width, 44);
    ctx.fillStyle = this.status === "failed" ? "#C92A2A" : "#E8590C";
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
      const boxH = 82;
      const boxY = vp.height - boxH - margin;

      ctx.fillStyle = "rgba(26, 29, 30, 0.9)";
      ctx.fillRect(margin, boxY, boxW, boxH);
      ctx.strokeStyle = holdRatio > 0 ? "#2B8A3E" : "rgba(246, 247, 244, 0.3)";
      ctx.lineWidth = 2;
      ctx.strokeRect(margin + 1, boxY + 1, boxW - 2, boxH - 2);

      ctx.fillStyle = "#D4D8DA";
      ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`DEMONSTRATE PROMPT ${this.matchedCount + 1}`, vp.width / 2, boxY + 20);

      ctx.fillStyle = "#F6F7F4";
      ctx.font = "700 20px system-ui, -apple-system, sans-serif";
      ctx.fillText(prompt, vp.width / 2, boxY + 46);

      // Hold verification meter
      const barW = Math.min(240, boxW - 48);
      const barX = (vp.width - barW) / 2;
      ctx.fillStyle = "rgba(246, 247, 244, 0.2)";
      ctx.fillRect(barX, boxY + 66, barW, 6);
      ctx.fillStyle = "#51CF66";
      ctx.fillRect(barX, boxY + 66, barW * holdRatio, 6);
    }

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const total = Math.max(1, this.promptQueue.length);
    const progress = this.status === "passed" ? 1 : Math.min(0.99, this.matchedCount / total);
    if (this.callout !== undefined) {
      return { status: this.status, progress, callout: this.callout };
    }
    return { status: this.status, progress };
  }
}
