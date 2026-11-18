import { mulberry32, shuffleWithRng } from "../prng";
import type { Baseline, Challenge, ChallengeContext, ChallengeResult, FaceSignal, Viewport } from "../types";

const SETTLE_GRACE_MS = 220;
const NOISE_FLOOR_RAD = 0.008;
const NOD_TRAVEL_THRESHOLD = 0.24;
const SHAKE_TRAVEL_THRESHOLD = 0.28;
const PEAK_SINGLE_THRESHOLD = 0.19;

interface QuestionItem {
  text: string;
  answer: "yes" | "no" | "either";
}

/**
 * Verbal Compliance challenge: answer rapid questions by nodding (yes) or shaking (no).
 */
export class InterviewChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private slotDurationMs = 2_400;
  private slotElapsedMs = 0;
  private answeredCount = 0;
  private questions: QuestionItem[] = [];
  private calloutPool: readonly string[] = ["VERBAL NON-COMPLIANCE"];
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private baseline!: Baseline;
  private seed = 1;

  private prevPitch: number | null = null;
  private prevYaw: number | null = null;
  private pitchTravel = 0;
  private yawTravel = 0;
  private maxAbsPitch = 0;
  private maxAbsYaw = 0;
  private notedBannerMs = 0;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.slotElapsedMs = 0;
    this.answeredCount = 0;
    this.status = "running";
    this.callout = undefined;
    this.baseline = ctx.baseline;
    this.seed = ctx.seed;
    this.notedBannerMs = 0;
    this.resetMotionWindow();

    const count = this.durationMs <= 5_000 ? 2 : 5;
    this.slotDurationMs = this.durationMs / count;

    const rng = mulberry32(ctx.seed);
    const pool = ctx.copy.questions ?? [{ text: "Were you born on Earth.", answer: "yes" as const }];
    this.questions = shuffleWithRng(pool, rng).slice(0, count);

    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }
  }

  getCurrentQuestion(): QuestionItem | null {
    return this.questions[this.answeredCount] ?? null;
  }

  private resetMotionWindow(): void {
    this.prevPitch = null;
    this.prevYaw = null;
    this.pitchTravel = 0;
    this.yawTravel = 0;
    this.maxAbsPitch = 0;
    this.maxAbsYaw = 0;
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    this.elapsedMs += clampedDt;
    this.slotElapsedMs += clampedDt;
    if (this.notedBannerMs > 0) {
      this.notedBannerMs = Math.max(0, this.notedBannerMs - clampedDt);
    }

    const q = this.questions[this.answeredCount];
    if (!q) {
      this.status = "passed";
      return;
    }

    if (this.slotElapsedMs >= SETTLE_GRACE_MS) {
      const dPitch = signal.pose.pitch - this.baseline.pitchRad;
      const dYaw = signal.pose.yaw - this.baseline.yawRad;

      if (this.prevPitch !== null && this.prevYaw !== null) {
        const dp = Math.abs(dPitch - this.prevPitch);
        const dy = Math.abs(dYaw - this.prevYaw);
        if (dp > NOISE_FLOOR_RAD) this.pitchTravel += dp;
        if (dy > NOISE_FLOOR_RAD) this.yawTravel += dy;
      }
      this.prevPitch = dPitch;
      this.prevYaw = dYaw;
      this.maxAbsPitch = Math.max(this.maxAbsPitch, Math.abs(dPitch));
      this.maxAbsYaw = Math.max(this.maxAbsYaw, Math.abs(dYaw));

      const detected = this.detectGesture();
      if (detected !== null) {
        if (q.answer !== "either" && detected !== q.answer) {
          this.status = "failed";
          this.callout = detected === "yes" ? "DECEPTIVE NODDING" : "INCRIMINATING HEAD SHAKE";
          return;
        }
        if (q.answer === "either") {
          this.notedBannerMs = 650;
        }
        this.answeredCount += 1;
        this.slotElapsedMs = 0;
        this.resetMotionWindow();
        if (this.answeredCount >= this.questions.length) {
          this.status = "passed";
          return;
        }
      }
    }

    if (this.slotElapsedMs >= this.slotDurationMs) {
      this.status = "failed";
      const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
      const timeoutCalls = this.calloutPool.filter((c) => c.includes("SILENCE") || c.includes("TIMED") || c.includes("HESITATION"));
      const pool = timeoutCalls.length > 0 ? timeoutCalls : this.calloutPool;
      this.callout = pool[Math.floor(rng() * pool.length)] ?? "SILENCE FILED AS GUILT";
    }
  }

  private detectGesture(): "yes" | "no" | null {
    const isNod =
      (this.pitchTravel >= NOD_TRAVEL_THRESHOLD && this.pitchTravel > this.yawTravel * 1.4) ||
      (this.maxAbsPitch >= PEAK_SINGLE_THRESHOLD && this.maxAbsYaw < 0.12);
    if (isNod) return "yes";

    const isShake =
      (this.yawTravel >= SHAKE_TRAVEL_THRESHOLD && this.yawTravel > this.pitchTravel * 1.4) ||
      (this.maxAbsYaw >= PEAK_SINGLE_THRESHOLD && this.maxAbsPitch < 0.12);
    if (isShake) return "no";

    return null;
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const q = this.getCurrentQuestion();
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
      `FORM 11-V · VERBAL COMPLIANCE (${this.answeredCount}/${this.questions.length})`,
      16,
      20,
    );

    ctx.textAlign = "right";
    ctx.fillText(`${slotRemaining}s`, vp.width - 16, 20);

    if (this.notedBannerMs > 0) {
      ctx.fillStyle = "rgba(232, 89, 12, 0.9)";
      ctx.fillRect(vp.width / 2 - 110, 56, 220, 24);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("ANSWER NOTED FOR THE FILE", vp.width / 2, 68);
    }

    if (q) {
      const margin = 16;
      const boxW = vp.width - margin * 2;
      const boxH = 88;
      const boxY = vp.height - boxH - margin;

      ctx.fillStyle = "rgba(26, 29, 30, 0.92)";
      ctx.fillRect(margin, boxY, boxW, boxH);
      ctx.strokeStyle = "rgba(246, 247, 244, 0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(margin + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

      ctx.fillStyle = "#E8590C";
      ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("NOD YES  ·  SHAKE NO", vp.width / 2, boxY + 18);

      ctx.fillStyle = "#F6F7F4";
      ctx.font = "600 16px system-ui, -apple-system, sans-serif";
      drawWrappedText(ctx, q.text, vp.width / 2, boxY + 52, boxW - 28, 20);
    }

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const total = Math.max(1, this.questions.length);
    const progress = this.status === "passed" ? 1 : Math.min(0.99, this.answeredCount / total);
    if (this.callout !== undefined) {
      return { status: this.status, progress, callout: this.callout };
    }
    return { status: this.status, progress };
  }
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(probe).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = probe;
    }
  }
  if (cur) lines.push(cur);
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, cx, startY + i * lineHeight);
  }
}
