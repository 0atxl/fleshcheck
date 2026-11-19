import { mulberry32, shuffleWithRng } from "../prng";
import { computeHumanPct } from "../scoring";
import { FONT_LABEL, FONT_TYPE, THEME } from "../theme";
import type {
  Challenge,
  ChallengeContext,
  ChallengeManifest,
  ChallengeResult,
  EvidenceMark,
  FaceSignal,
  TryRecord,
  Viewport,
} from "../types";
import { drawWrappedText } from "./hud";

const INTERMISSION_MS = 450;

/**
 * Annual Audit challenge: chains three 4-second mini-rounds from distinct face
 * challenges with a single daily attempt and per-round emoji squares.
 */
export class FullAuditChallenge implements Challenge<FaceSignal> {
  private subManifests: ChallengeManifest[] = [];
  private activeChallenge: Challenge | null = null;
  private roundIndex = 0;
  private roundDurationMs = 4_000;
  private roundRecords: TryRecord[] = [];
  private roundProgresses: number[] = [];
  private completedMilestones = 0;
  private currentRoundPaused = false;
  private intermissionMs = 0;
  private pendingIntermissionDraw = false;
  private lastRoundNote = "";
  private lastRoundPassed = false;
  private transitions: string[] = [];
  private calloutPool: readonly string[] = ["ANNUAL AUDIT FAILED"];
  private firstFailCallout: string | undefined;
  private firstFailEvidence: EvidenceMark | undefined;
  private status: ChallengeResult["status"] = "running";
  private baseCtx!: ChallengeContext;

  constructor(private readonly getCandidates: () => readonly ChallengeManifest[]) {}

  init(ctx: ChallengeContext): void {
    this.baseCtx = ctx;
    this.roundIndex = 0;
    this.roundRecords = [];
    this.roundProgresses = [];
    this.completedMilestones = 0;
    this.currentRoundPaused = false;
    this.intermissionMs = 0;
    this.pendingIntermissionDraw = false;
    this.lastRoundNote = "";
    this.lastRoundPassed = false;
    this.firstFailCallout = undefined;
    this.firstFailEvidence = undefined;
    this.status = "running";

    const eligible = this.getCandidates().filter(
      (c) => c.enabled && c.model === "face" && c.id !== "FULL_AUDIT",
    );
    const rng = mulberry32(ctx.seed);
    this.subManifests = shuffleWithRng(eligible, rng).slice(0, 3);
    this.roundDurationMs = Math.max(1_000, Math.floor(ctx.durationMs / Math.max(1, this.subManifests.length)));

    const srcTransitions = ctx.copy.transitions ?? ["Forwarding dossier to next desk."];
    this.transitions = shuffleWithRng(srcTransitions, rng);
    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }

    this.startRound(0);
  }

  getSubManifests(): readonly ChallengeManifest[] {
    return this.subManifests;
  }

  onPause(): void {
    this.currentRoundPaused = true;
    this.activeChallenge?.onPause?.();
  }

  private startRound(index: number): void {
    const manifest = this.subManifests[index];
    if (!manifest) {
      this.finalizeAudit();
      return;
    }
    this.currentRoundPaused = false;
    const ch = manifest.create();
    ch.init({
      seed: (this.baseCtx.seed + (index + 1) * 7919) >>> 0,
      baseline: this.baseCtx.baseline,
      copy: manifest.copy,
      viewport: this.baseCtx.viewport,
      durationMs: this.roundDurationMs,
      ...(this.baseCtx.copyContext ? { copyContext: this.baseCtx.copyContext } : {}),
    });
    this.activeChallenge = ch;
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));

    if (this.intermissionMs > 0) {
      this.pendingIntermissionDraw = false;
      this.intermissionMs = Math.max(0, this.intermissionMs - clampedDt);
      if (this.intermissionMs === 0) {
        this.roundIndex += 1;
        this.startRound(this.roundIndex);
      }
      return;
    }

    if (!this.activeChallenge) {
      this.finalizeAudit();
      return;
    }

    this.activeChallenge.update(clampedDt, signal);
    const subRes = this.activeChallenge.getResult();

    if (subRes.status === "passed" || subRes.status === "failed") {
      const passed = subRes.status === "passed";
      this.roundRecords.push({
        passed,
        pct: computeHumanPct(subRes.progress, subRes.status),
        paused: this.currentRoundPaused,
      });
      this.roundProgresses.push(passed ? 1 : subRes.progress);
      this.completedMilestones += subRes.milestones ?? 0;

      if (!passed) {
        if (!this.firstFailCallout) {
          this.firstFailCallout = subRes.callout ?? "STATION REJECTED";
        }
        if (!this.firstFailEvidence && subRes.evidence) {
          this.firstFailEvidence = subRes.evidence;
        }
      }

      if (this.roundIndex < this.subManifests.length - 1) {
        this.lastRoundPassed = passed;
        this.lastRoundNote =
          this.transitions[this.roundIndex % this.transitions.length] ??
          "Forwarding dossier to next desk.";
        this.intermissionMs = INTERMISSION_MS;
        // Defer the dark intermission curtain by one draw tick so GameLoop captures
        // the unobstructed fail frame for the evidence card before masking it.
        this.pendingIntermissionDraw = true;
      } else {
        this.finalizeAudit();
      }
    }
  }

  private finalizeAudit(): void {
    const allPassed =
      this.roundRecords.length === this.subManifests.length &&
      this.roundRecords.every((r) => r.passed);
    this.status = allPassed ? "passed" : "failed";
    if (!allPassed && !this.firstFailCallout) {
      this.firstFailCallout = this.calloutPool[0] ?? "ANNUAL AUDIT FAILED";
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const currentManifest = this.subManifests[this.roundIndex];

    if (this.intermissionMs > 0 && !this.pendingIntermissionDraw) {
      ctx.save();
      ctx.fillStyle = "rgba(20, 19, 15, 0.78)";
      ctx.fillRect(0, 0, vp.width, vp.height);

      const cardW = Math.min(vp.width - 28, 440);
      const cardH = 98;
      const cardX = (vp.width - cardW) / 2;
      const cardY = (vp.height - cardH) / 2;
      ctx.fillStyle = THEME.paper;
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.fillStyle = this.lastRoundPassed ? THEME.stampBlue : THEME.stampRed;
      ctx.fillRect(cardX, cardY + cardH - 4, cardW, 4);

      ctx.fillStyle = this.lastRoundPassed ? THEME.stampBlue : THEME.stampRed;
      ctx.font = `700 18px ${FONT_LABEL}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `STATION ${this.roundIndex + 1} OF ${this.subManifests.length}: ${this.lastRoundPassed ? "CLEARED" : "REJECTED"}`,
        vp.width / 2,
        cardY + 30,
        cardW - 24,
      );

      ctx.fillStyle = THEME.ink;
      ctx.font = `500 15px ${FONT_TYPE}`;
      drawWrappedText(ctx, this.lastRoundNote, vp.width / 2, cardY + 64, cardW - 28, 19, 2);
      ctx.restore();
      return;
    }

    this.pendingIntermissionDraw = false;

    if (this.activeChallenge) {
      this.activeChallenge.draw(ctx, vp);
    }

    // Compact paper station chip placed cleanly below the top-right timer tag
    ctx.save();
    const stationTitle = currentManifest ? currentManifest.title.toUpperCase() : "AUDIT";
    const chipText = `AUDIT ${Math.min(this.roundIndex + 1, this.subManifests.length)}/${this.subManifests.length} · ${stationTitle}`;
    ctx.font = `700 12px ${FONT_LABEL}`;
    const chipW = Math.min(vp.width - 24, ctx.measureText(chipText).width + 16);
    const chipX = vp.width - chipW - 12;
    const chipY = 50;
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(chipX, chipY, chipW, 22);
    ctx.fillStyle = THEME.formBlue;
    ctx.fillRect(chipX, chipY + 20, chipW, 2);
    ctx.fillStyle = THEME.ink;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(chipText, vp.width - 20, chipY + 11, chipW - 16);
    ctx.restore();
  }

  getResult(): ChallengeResult {
    const count = Math.max(1, this.subManifests.length);
    let progressSum = this.roundProgresses.reduce((acc, v) => acc + v, 0);
    let milestones = this.completedMilestones;
    let typed: number | undefined;
    if (this.status === "running" && this.activeChallenge && this.intermissionMs === 0) {
      const activeRes = this.activeChallenge.getResult();
      progressSum += activeRes.progress;
      milestones += activeRes.milestones ?? 0;
      typed = activeRes.typed;
    }
    const progress =
      this.status === "passed" ? 1 : Math.min(0.99, progressSum / count);

    const res: ChallengeResult = {
      status: this.status,
      progress,
      milestones,
      ...(typed !== undefined ? { typed } : {}),
      roundRecords: [...this.roundRecords],
    };
    if (this.status === "failed" && this.firstFailCallout) {
      res.callout = this.firstFailCallout;
    }
    if (this.status === "failed" && this.firstFailEvidence) {
      res.evidence = this.firstFailEvidence;
    }
    return res;
  }
}
