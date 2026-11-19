import { mulberry32, shuffleWithRng } from "../prng";
import type { Challenge, ChallengeContext, ChallengeResult, FaceSignal, Viewport } from "../types";
import { drawWrappedText } from "./hud";

const SMILE_THRESHOLD = 0.16;
const PUFF_THRESHOLD = 0.22;
const JAW_THRESHOLD = 0.24;
const LEAK_HOLD_MS = 250;

/**
 * Affect Review challenge: maintain a neutral face while deadpan taunts escalate.
 */
export class PokerFaceChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private leakMs = 0;
  private leakRatio = 0;
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private activeTaunts: string[] = [];
  private calloutPool: readonly string[] = ["EMOTIONAL LEAK DETECTED"];
  private seed = 1;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.leakMs = 0;
    this.leakRatio = 0;
    this.status = "running";
    this.callout = undefined;
    this.seed = ctx.seed;

    const rng = mulberry32(ctx.seed);
    const sourceTaunts = ctx.copy.taunts ?? ["Maintain a neutral face for the record."];
    const third = Math.max(1, Math.floor(sourceTaunts.length / 3));
    const tier1 = shuffleWithRng(sourceTaunts.slice(0, third), rng);
    const tier2 = shuffleWithRng(sourceTaunts.slice(third, third * 2), rng);
    const tier3 = shuffleWithRng(sourceTaunts.slice(third * 2), rng);

    const fullList = [
      tier1[0] ?? sourceTaunts[0]!,
      tier1[1] ?? tier1[0] ?? sourceTaunts[0]!,
      tier2[0] ?? sourceTaunts[0]!,
      tier2[1] ?? tier2[0] ?? sourceTaunts[0]!,
      tier3[0] ?? sourceTaunts[0]!,
      tier3[1] ?? tier3[0] ?? sourceTaunts[0]!,
    ];
    this.activeTaunts = this.durationMs <= 5_000 ? [fullList[2]!, fullList[4]!] : fullList;

    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    this.elapsedMs += clampedDt;

    const smileLeft = signal.delta.mouthSmileLeft ?? 0;
    const smileRight = signal.delta.mouthSmileRight ?? 0;
    const smileDelta = Math.max(smileLeft, smileRight);
    const puffDelta = signal.delta.cheekPuff ?? 0;
    const jawDelta = signal.delta.jawOpen ?? 0;

    const ratio = Math.max(
      0,
      smileDelta / SMILE_THRESHOLD,
      puffDelta / PUFF_THRESHOLD,
      jawDelta / JAW_THRESHOLD,
    );
    this.leakRatio = Math.min(1.5, ratio);

    if (ratio >= 1) {
      this.leakMs += clampedDt;
    } else {
      this.leakMs = Math.max(0, this.leakMs - clampedDt * 1.5);
    }

    if (this.leakMs >= LEAK_HOLD_MS) {
      this.status = "failed";
      const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
      const idx = Math.floor(rng() * this.calloutPool.length);
      this.callout = this.calloutPool[idx] ?? "EMOTIONAL LEAK DETECTED";
      return;
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const tauntIdx = Math.min(
      this.activeTaunts.length - 1,
      Math.floor(progress * this.activeTaunts.length),
    );
    const taunt = this.activeTaunts[tauntIdx] ?? "";

    // Top thin progress bar
    ctx.save();
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(0, 0, vp.width, 44);
    ctx.fillStyle = this.leakRatio >= 1 ? "#C92A2A" : "#E8590C";
    ctx.fillRect(0, 40, vp.width * progress, 4);

    // Header label + timer
    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#F6F7F4";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("FORM 27-B · AFFECT REVIEW", 16, 20);

    const remaining = Math.max(0, (this.durationMs - this.elapsedMs) / 1000).toFixed(1);
    ctx.textAlign = "right";
    ctx.fillText(`${remaining}s`, vp.width - 16, 20);

    // Composure meter on top-left beneath header
    const meterW = Math.min(180, vp.width * 0.36);
    const meterX = 16;
    const meterY = 58;
    ctx.fillStyle = "rgba(26, 29, 30, 0.65)";
    ctx.fillRect(meterX, meterY, meterW, 18);
    const fillRatio = Math.min(1, this.leakRatio);
    ctx.fillStyle = fillRatio >= 1 ? "#C92A2A" : fillRatio > 0.6 ? "#E8590C" : "#2B8A3E";
    ctx.fillRect(meterX + 2, meterY + 2, (meterW - 4) * fillRatio, 14);

    ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#F6F7F4";
    ctx.textAlign = "left";
    ctx.fillText("AFFECT DRIFT", meterX + 6, meterY + 9);

    // Taunt placard at bottom
    if (taunt) {
      const boxMargin = 16;
      const boxW = vp.width - boxMargin * 2;
      const boxH = 68;
      const boxY = vp.height - boxH - boxMargin;

      ctx.fillStyle = "rgba(26, 29, 30, 0.88)";
      ctx.fillRect(boxMargin, boxY, boxW, boxH);
      ctx.strokeStyle = "rgba(246, 247, 244, 0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(boxMargin + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

      ctx.fillStyle = "#F6F7F4";
      ctx.font = "500 16px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      drawWrappedText(ctx, taunt, vp.width / 2, boxY + boxH / 2, boxW - 32, 20);
    }

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    if (this.callout !== undefined) {
      return { status: this.status, progress, callout: this.callout };
    }
    return { status: this.status, progress };
  }
}
