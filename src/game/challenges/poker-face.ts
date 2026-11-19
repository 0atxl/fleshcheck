import { POKER_FACE_CALM_CALLOUTS, POKER_FACE_NOTES } from "../../copy/poker-face";
import { renderCopy } from "../../copy/template";
import {
  blitStamp,
  createStampBitmap,
  pickStampText,
  stampColor,
} from "../../output/stamp";
import { mulberry32, shuffleWithRng } from "../prng";
import { FONT_TYPE, THEME } from "../theme";
import type {
  Baseline,
  Challenge,
  ChallengeContext,
  ChallengeResult,
  ChallengeVariant,
  EvidenceMark,
  FaceSignal,
  Point2D,
  Rect2D,
  Viewport,
} from "../types";
import { wrapLines } from "./hud";

const SMILE_THRESHOLD = 0.16;
const PUFF_THRESHOLD = 0.22;
const JAW_THRESHOLD = 0.24;
const LEAK_HOLD_MS = 250;
/** Peak leak ratio at or below which a passing subject is flagged as suspiciously calm. */
export const TOO_CALM_THRESHOLD = 0.15;

/** Typewriter reveal speed for taunts. */
const TYPE_CHARS_PER_SEC = 45;
/** Case notes trigger well below the fail threshold so the player feels observed. */
const NOTE_RATIO = 0.5;
const NOTE_REFRACTORY_MS = 1_100;
const NOTE_GLOBAL_GAP_MS = 700;
const MAX_NOTES_SHOWN = 3;

const MOUTH_POINTS = [61, 291, 0, 17] as const;
const CHEEK_POINTS = [205, 425, 61, 291] as const;

type Feature = "smile" | "puff" | "jaw";
type NoteKind = keyof typeof POKER_FACE_NOTES;

interface CaseNote {
  atMs: number;
  text: string;
}

/**
 * Affect Review challenge: maintain a neutral face while deadpan taunts escalate.
 *
 * Feedback is physical rather than a health bar: a rubber stamp hangs over the
 * subject and sinks toward them as their composure drifts, and the office types
 * small notes about every twitch.
 */
export class PokerFaceChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private leakMs = 0;
  private leakRatio = 0;
  private maxLeakRatio = 0;
  private shownRatio = 0;
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private evidence: EvidenceMark | undefined;
  private variant: ChallengeVariant | undefined;
  private stampText: string | undefined;
  private activeTaunts: string[] = [];
  private calloutPool: readonly string[] = ["EMOTIONAL LEAK DETECTED"];
  private seed = 1;
  private baseline: Baseline | null = null;

  private dominant: Feature = "smile";
  private dominantValue = 0;
  private lastLandmarks: readonly Point2D[] = [];
  private faceBox: Rect2D | null = null;

  private notes: CaseNote[] = [];
  private noteCounts: Partial<Record<NoteKind, number>> = {};
  private noteLastMs: Partial<Record<NoteKind, number>> = {};
  private noteActive: Partial<Record<NoteKind, boolean>> = {};
  private lastNoteMs = -Infinity;

  private hangingStamp: HTMLCanvasElement | null = null;
  private stampTried = false;
  private typedChars = 0;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.leakMs = 0;
    this.leakRatio = 0;
    this.maxLeakRatio = 0;
    this.shownRatio = 0;
    this.status = "running";
    this.callout = undefined;
    this.evidence = undefined;
    this.variant = undefined;
    this.stampText = undefined;
    this.seed = ctx.seed;
    this.baseline = ctx.baseline;
    this.dominant = "smile";
    this.dominantValue = 0;
    this.lastLandmarks = [];
    this.faceBox = null;
    this.notes = [];
    this.noteCounts = {};
    this.noteLastMs = {};
    this.noteActive = {};
    this.lastNoteMs = -Infinity;
    this.hangingStamp = null;
    this.stampTried = false;
    this.typedChars = 0;

    const rng = mulberry32(ctx.seed);
    const sourceTaunts = ctx.copy.taunts ?? ["Maintain a neutral face for the record."];
    const third = Math.max(1, Math.floor(sourceTaunts.length / 3));
    const resolveTier = (slice: readonly string[]): string[] =>
      slice
        .map((line) => renderCopy(line, ctx.copyContext))
        .filter((line): line is string => line !== null);

    const fallbackLine = "Maintain a neutral face for the record.";
    const tier1 = shuffleWithRng(resolveTier(sourceTaunts.slice(0, third)), rng);
    const tier2 = shuffleWithRng(resolveTier(sourceTaunts.slice(third, third * 2)), rng);
    const tier3 = shuffleWithRng(resolveTier(sourceTaunts.slice(third * 2)), rng);

    const fullList = [
      tier1[0] ?? fallbackLine,
      tier1[1] ?? tier1[0] ?? fallbackLine,
      tier2[0] ?? tier1[0] ?? fallbackLine,
      tier2[1] ?? tier2[0] ?? fallbackLine,
      tier3[0] ?? tier2[0] ?? fallbackLine,
      tier3[1] ?? tier3[0] ?? fallbackLine,
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
    this.updateTypedChars();

    this.lastLandmarks = signal.landmarks;
    this.faceBox = signal.faceBox;

    const d = signal.delta;
    const smileDelta = Math.max(d.mouthSmileLeft ?? 0, d.mouthSmileRight ?? 0);
    const puffDelta = d.cheekPuff ?? 0;
    const jawDelta = d.jawOpen ?? 0;

    const smileRatio = smileDelta / SMILE_THRESHOLD;
    const puffRatio = puffDelta / PUFF_THRESHOLD;
    const jawRatio = jawDelta / JAW_THRESHOLD;

    const ratio = Math.max(0, smileRatio, puffRatio, jawRatio);
    this.leakRatio = Math.min(1.5, ratio);
    if (ratio > this.maxLeakRatio) {
      this.maxLeakRatio = ratio;
    }
    this.shownRatio += (Math.min(1, this.leakRatio) - this.shownRatio) * Math.min(1, clampedDt / 140);

    if (ratio === smileRatio) {
      this.dominant = "smile";
      this.dominantValue = smileDelta;
    } else if (ratio === puffRatio) {
      this.dominant = "puff";
      this.dominantValue = puffDelta;
    } else {
      this.dominant = "jaw";
      this.dominantValue = jawDelta;
    }

    this.collectNotes(signal, smileRatio, puffRatio, jawRatio);

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
      this.evidence = this.buildEvidence();
      return;
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
      if (this.maxLeakRatio <= TOO_CALM_THRESHOLD + 1e-6) {
        this.variant = "too-calm";
        this.stampText = pickStampText(this.seed, true, "too-calm");
        const rng = mulberry32((this.seed ^ 0x1b873593) >>> 0);
        this.callout =
          POKER_FACE_CALM_CALLOUTS[Math.floor(rng() * POKER_FACE_CALM_CALLOUTS.length)] ??
          POKER_FACE_CALM_CALLOUTS[0];
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const compact = vp.width < 520;

    ctx.save();

    this.drawHangingStamp(ctx, vp);

    // Progress line along the very top edge
    ctx.fillStyle = "rgba(20, 19, 15, 0.45)";
    ctx.fillRect(0, 0, vp.width, 4);
    ctx.fillStyle = this.shownRatio > 0.7 ? THEME.stampRed : THEME.paper;
    ctx.fillRect(0, 0, vp.width * progress, 4);

    // Timer tag, top right
    const remaining = Math.max(0, (this.durationMs - this.elapsedMs) / 1000).toFixed(1);
    ctx.font = `700 ${compact ? 17 : 20}px ${FONT_TYPE}`;
    const tagW = ctx.measureText(`${remaining}s`).width + 20;
    const tagH = compact ? 28 : 32;
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(vp.width - tagW - 12, 14, tagW, tagH);
    ctx.fillStyle = THEME.ink;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${remaining}s`, vp.width - 22, 14 + tagH / 2 + 1);

    this.drawNotes(ctx);
    this.drawTaunt(ctx, vp, compact);

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    return {
      status: this.status,
      progress,
      typed: this.typedChars,
      ...(this.callout !== undefined ? { callout: this.callout } : {}),
      ...(this.evidence !== undefined ? { evidence: this.evidence } : {}),
      ...(this.variant !== undefined ? { variant: this.variant } : {}),
      ...(this.stampText !== undefined ? { stampText: this.stampText } : {}),
    };
  }

  private updateTypedChars(): void {
    const { idx, text, sinceMs } = this.currentTaunt();
    if (!text) return;
    let prior = 0;
    for (let i = 0; i < idx; i++) {
      prior += this.activeTaunts[i]?.length ?? 0;
    }
    const shown = Math.min(text.length, Math.max(0, Math.floor((sinceMs / 1000) * TYPE_CHARS_PER_SEC)));
    const next = prior + shown;
    if (next > this.typedChars) {
      this.typedChars = next;
    }
  }

  private currentTaunt(): { idx: number; text: string; sinceMs: number } {
    const n = this.activeTaunts.length;
    if (n === 0) return { idx: 0, text: "", sinceMs: 0 };
    const slot = this.durationMs / n;
    const idx = Math.min(n - 1, Math.floor(this.elapsedMs / slot));
    return { idx, text: this.activeTaunts[idx] ?? "", sinceMs: this.elapsedMs - idx * slot };
  }

  private drawTaunt(ctx: CanvasRenderingContext2D, vp: Viewport, compact: boolean): void {
    const { text, sinceMs } = this.currentTaunt();
    if (!text) return;

    const fontSize = compact ? 19 : 22;
    const lineH = Math.round(fontSize * 1.35);
    const margin = 14;
    const pad = 14;
    const boxW = vp.width - margin * 2;

    ctx.font = `500 ${fontSize}px ${FONT_TYPE}`;
    const lines = wrapLines(ctx, text, boxW - pad * 2, 3);
    const boxH = lines.length * lineH + pad * 2 - 4;
    const boxY = vp.height - boxH - margin;

    ctx.fillStyle = THEME.paper;
    ctx.fillRect(margin, boxY, boxW, boxH);
    ctx.fillStyle = THEME.ink;
    ctx.fillRect(margin, boxY + boxH - 3, boxW, 3);

    // Typewriter reveal over the fully wrapped layout so lines never reflow
    let remaining = Math.max(0, Math.floor((sinceMs / 1000) * TYPE_CHARS_PER_SEC));
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = THEME.ink;
    let caretX = margin + pad;
    let caretY = boxY + pad - 2 + lineH / 2;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const shown = line.slice(0, remaining);
      const y = boxY + pad - 2 + i * lineH + lineH / 2;
      ctx.fillText(shown, margin + pad, y);
      caretX = margin + pad + ctx.measureText(shown).width;
      caretY = y;
      remaining -= line.length + 1;
      if (remaining <= 0) break;
    }
    const blink = Math.floor(this.elapsedMs / 450) % 2 === 0;
    if (blink) {
      ctx.fillStyle = THEME.ink;
      ctx.fillRect(caretX + 2, caretY - fontSize * 0.55, Math.ceil(fontSize * 0.5), Math.ceil(fontSize * 1.1));
    }
  }

  private drawNotes(ctx: CanvasRenderingContext2D): void {
    const shown = this.notes.slice(-MAX_NOTES_SHOWN);
    if (shown.length === 0) return;

    ctx.font = `500 13px ${FONT_TYPE}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let y = 44;
    for (let i = 0; i < shown.length; i++) {
      const note = shown[i]!;
      const age = this.elapsedMs - note.atMs;
      const fade = Math.max(0.35, 1 - age / 7_000);
      const line = `[${formatClock(note.atMs)}] ${note.text}`;
      const w = ctx.measureText(line).width + 14;
      ctx.globalAlpha = fade;
      ctx.fillStyle = "rgba(20, 19, 15, 0.72)";
      ctx.fillRect(12, y, w, 21);
      ctx.fillStyle = THEME.paper;
      ctx.fillText(line, 19, y + 11);
      y += 24;
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A ghost of the stamp the office intends to use, sinking toward the subject
   * as composure drifts. Invisible while composed.
   */
  private drawHangingStamp(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const a = Math.max(0, Math.min(1, (this.shownRatio - 0.1) / 0.9));
    if (a <= 0) return;

    if (!this.hangingStamp && !this.stampTried) {
      this.stampTried = true;
      this.hangingStamp = createStampBitmap(
        pickStampText(this.seed, false),
        stampColor(false),
        this.seed,
      );
    }
    if (!this.hangingStamp) return;

    const face = this.faceBox;
    const cx = face && face.w > 0 ? face.x + face.w / 2 : vp.width / 2;
    const cy = face && face.h > 0 ? face.y + face.h * 0.34 : vp.height * 0.4;
    const shake = a * a * 5;
    const t = this.elapsedMs;

    blitStamp(ctx, this.hangingStamp, {
      cx: cx + Math.sin(t * 0.09) * shake,
      cy: cy + Math.cos(t * 0.11) * shake,
      width: Math.min(vp.width * 0.62, 400) * (1.55 - 0.55 * a),
      rotation: -0.09 + Math.sin(t * 0.03) * 0.02 * a,
      alpha: 0.1 + 0.55 * a,
    });
  }

  private collectNotes(
    signal: FaceSignal,
    smileRatio: number,
    puffRatio: number,
    jawRatio: number,
  ): void {
    const d = signal.delta;
    const blink = Math.min(d.eyeBlinkLeft ?? 0, d.eyeBlinkRight ?? 0) > 0.55;
    const brow =
      Math.max(
        d.browInnerUp ?? 0,
        d.browDownLeft ?? 0,
        d.browDownRight ?? 0,
        d.browOuterUpLeft ?? 0,
        d.browOuterUpRight ?? 0,
      ) > 0.28;
    const base = this.baseline;
    const head =
      base !== null &&
      (Math.abs(signal.pose.yaw - base.yawRad) > 0.14 ||
        Math.abs(signal.pose.pitch - base.pitchRad) > 0.14);

    const active: Record<NoteKind, boolean> = {
      blink,
      brow,
      mouth: smileRatio > NOTE_RATIO && smileRatio < 1,
      cheek: puffRatio > NOTE_RATIO && puffRatio < 1,
      jaw: jawRatio > NOTE_RATIO && jawRatio < 1,
      head,
    };

    for (const kind of Object.keys(active) as NoteKind[]) {
      const wasActive = this.noteActive[kind] === true;
      this.noteActive[kind] = active[kind];
      if (!active[kind] || wasActive) continue; // rising edge only

      const last = this.noteLastMs[kind] ?? -Infinity;
      if (this.elapsedMs - last < NOTE_REFRACTORY_MS) continue;
      if (this.elapsedMs - this.lastNoteMs < NOTE_GLOBAL_GAP_MS) continue;

      const pool = POKER_FACE_NOTES[kind];
      const count = this.noteCounts[kind] ?? 0;
      this.noteCounts[kind] = count + 1;
      this.noteLastMs[kind] = this.elapsedMs;
      this.lastNoteMs = this.elapsedMs;
      this.notes.push({ atMs: this.elapsedMs, text: pool[count % pool.length]! });
      if (this.notes.length > 6) this.notes.shift();
    }
  }

  private buildEvidence(): EvidenceMark {
    const names: Record<Feature, string> = { smile: "Smile", puff: "Cheek", jaw: "Jaw" };
    const limits: Record<Feature, number> = {
      smile: SMILE_THRESHOLD,
      puff: PUFF_THRESHOLD,
      jaw: JAW_THRESHOLD,
    };
    const points = this.dominant === "puff" ? CHEEK_POINTS : MOUTH_POINTS;
    const rect = boundsOf(this.lastLandmarks, points, this.dominant === "puff" ? 0.2 : 0.35);
    return {
      rect,
      label: `${names[this.dominant]} ${this.dominantValue.toFixed(2)} / limit ${limits[this.dominant].toFixed(2)}`,
    };
  }
}

function formatClock(ms: number): string {
  const s = Math.max(0, ms / 1000);
  return s.toFixed(1).padStart(4, "0");
}

function boundsOf(landmarks: readonly Point2D[], indices: readonly number[], padFrac: number): Rect2D {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const idx of indices) {
    const p = landmarks[idx];
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const w = Math.max(64, (maxX - minX) * (1 + padFrac * 2));
  const h = Math.max(44, (maxY - minY) * (1 + padFrac * 2));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
