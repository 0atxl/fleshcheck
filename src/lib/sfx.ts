const MUTE_KEY = "fleshcheck:muted";

/**
 * Procedural WebAudio synthesizer for deadpan compliance SFX.
 * Unlocked on user click gesture; zero external audio assets.
 */
export class ComplianceSfx {
  private ctx: AudioContext | null = null;
  private muted: boolean;

  constructor() {
    this.muted = readMuted();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(next: boolean): void {
    this.muted = next;
    writeMuted(next);
  }

  unlock(): void {
    if (this.muted || typeof window === "undefined") return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  playTick(): void {
    this.tone(720, 0.035, "square", 0.04);
  }

  playCalibrateHum(): void {
    this.tone(180, 0.25, "sine", 0.04, 240);
  }

  playAlertBeep(): void {
    this.tone(540, 0.09, "triangle", 0.06);
  }

  playStampThud(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  playPassChime(): void {
    this.tone(523.25, 0.09, "sine", 0.07);
    window.setTimeout(() => this.tone(659.25, 0.14, "sine", 0.07), 90);
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    if (!this.ctx) this.unlock();
    if (!this.ctx || this.ctx.state !== "running") return null;
    return this.ctx;
  }

  private tone(
    freq: number,
    durationSec: number,
    type: OscillatorType,
    volume: number,
    endFreq?: number,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.linearRampToValueAtTime(endFreq, now + durationSec);
    }

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }
}

function readMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(MUTE_KEY, muted ? "1" : "0");
    }
  } catch {
    // Ignore storage errors
  }
}
