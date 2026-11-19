import { afterEach, describe, expect, it, vi } from "vitest";
import { ComplianceSfx } from "../src/lib/sfx";

interface FakeParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

function makeParam(initial = 0): FakeParam {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

interface FakeAudioRig {
  ctx: AudioContext;
  oscillators: Array<{
    type: OscillatorType;
    frequency: FakeParam;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }>;
  sources: Array<{
    buffer: AudioBuffer | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }>;
  filters: Array<{
    type: BiquadFilterType;
    frequency: FakeParam;
    Q: FakeParam;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>;
  gains: Array<{
    gain: FakeParam;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>;
  close: ReturnType<typeof vi.fn>;
}

function makeFakeAudioRig(): FakeAudioRig {
  const oscillators: FakeAudioRig["oscillators"] = [];
  const sources: FakeAudioRig["sources"] = [];
  const filters: FakeAudioRig["filters"] = [];
  const gains: FakeAudioRig["gains"] = [];
  const close = vi.fn().mockResolvedValue(undefined);

  const ctx = {
    state: "running",
    currentTime: 1,
    sampleRate: 44100,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close,
    createOscillator: () => {
      const node = {
        type: "sine" as OscillatorType,
        frequency: makeParam(440),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      oscillators.push(node);
      return node;
    },
    createBuffer: (_ch: number, len: number, sr: number) => {
      const data = new Float32Array(len);
      return {
        length: len,
        sampleRate: sr,
        duration: len / sr,
        getChannelData: () => data,
      };
    },
    createBufferSource: () => {
      const node = {
        buffer: null as AudioBuffer | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      sources.push(node);
      return node;
    },
    createBiquadFilter: () => {
      const node = {
        type: "lowpass" as BiquadFilterType,
        frequency: makeParam(1000),
        Q: makeParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      filters.push(node);
      return node;
    },
    createGain: () => {
      const node = {
        gain: makeParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(node);
      return node;
    },
  } as unknown as AudioContext;

  return { ctx, oscillators, sources, filters, gains, close };
}

const origWindow = globalThis.window;

afterEach(() => {
  globalThis.window = origWindow;
  vi.restoreAllMocks();
});

function installWindow(AudioContextCtor?: unknown) {
  const storage = new Map<string, string>();
  globalThis.window = {
    AudioContext: AudioContextCtor,
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    },
  } as unknown as Window & typeof globalThis;
  return storage;
}

describe("ComplianceSfx", () => {
  it("handles missing or throwing AudioContext safely", () => {
    installWindow(undefined);
    const sfx = new ComplianceSfx();
    expect(() => {
      sfx.unlock();
      sfx.playTick();
      sfx.playCalibrateHum();
      sfx.playAlertBeep();
      sfx.playStampThud();
      sfx.playPaperRustle();
      sfx.playTypeClack();
      sfx.startAmbientHum();
      sfx.stopAmbientHum();
      sfx.playPassChime();
      sfx.close();
    }).not.toThrow();

    installWindow(function ThrowingAudioContext() {
      throw new Error("Audio blocked");
    });
    const sfx2 = new ComplianceSfx();
    expect(() => {
      sfx2.unlock();
      sfx2.playStampThud();
      sfx2.startAmbientHum();
    }).not.toThrow();
  });

  it("plays nothing while muted and persists mute state", () => {
    const rig = makeFakeAudioRig();
    const storage = installWindow(function FakeCtx() {
      return rig.ctx;
    });
    const sfx = new ComplianceSfx();
    sfx.setMuted(true);
    expect(storage.get("fleshcheck:muted")).toBe("1");

    sfx.unlock();
    sfx.playStampThud();
    sfx.playPaperRustle();
    sfx.playTypeClack();
    sfx.startAmbientHum();
    sfx.playPassChime();

    expect(rig.oscillators.length).toBe(0);
    expect(rig.sources.length).toBe(0);
  });

  it("synthesizes stamp thud with noise transient + low sine drop and cleans up nodes", () => {
    const rig = makeFakeAudioRig();
    installWindow(function FakeCtx() {
      return rig.ctx;
    });
    const sfx = new ComplianceSfx();
    sfx.unlock();
    sfx.playStampThud();

    expect(rig.sources.length).toBe(1);
    expect(rig.oscillators.length).toBe(1);
    expect(rig.oscillators[0]!.type).toBe("sine");
    expect(rig.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(92, 1);
    const rampCall = rig.oscillators[0]!.frequency.exponentialRampToValueAtTime.mock.calls[0];
    expect(rampCall?.[0]).toBe(45);
    expect(rampCall?.[1]).toBeCloseTo(1.14, 5);

    // Trigger onended callbacks and verify all nodes disconnect cleanly
    rig.sources[0]!.onended?.();
    rig.oscillators[0]!.onended?.();
    for (const s of rig.sources) expect(s.disconnect).toHaveBeenCalled();
    for (const o of rig.oscillators) expect(o.disconnect).toHaveBeenCalled();
    for (const f of rig.filters) expect(f.disconnect).toHaveBeenCalled();
    for (const g of rig.gains) expect(g.disconnect).toHaveBeenCalled();
  });

  it("synthesizes paper rustle and rate-caps typewriter clacks", () => {
    const rig = makeFakeAudioRig();
    installWindow(function FakeCtx() {
      return rig.ctx;
    });
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const sfx = new ComplianceSfx();
    sfx.unlock();
    sfx.playPaperRustle();
    expect(rig.sources.length).toBe(1);
    expect(rig.filters.length).toBe(1);

    // Rapid clacks within 55 ms window are rate-capped to 1
    sfx.playTypeClack();
    now += 15;
    sfx.playTypeClack();
    now += 20;
    sfx.playTypeClack();
    expect(rig.sources.length).toBe(2);

    // After min gap elapses, next clack plays
    now += 60;
    sfx.playTypeClack();
    expect(rig.sources.length).toBe(3);

    for (const s of rig.sources) s.onended?.();
    for (const s of rig.sources) expect(s.disconnect).toHaveBeenCalled();
  });

  it("manages ambient hum lifecycle across mute toggles and stop paths without leaking", () => {
    const rig = makeFakeAudioRig();
    installWindow(function FakeCtx() {
      return rig.ctx;
    });

    const sfx = new ComplianceSfx();
    sfx.unlock();
    sfx.startAmbientHum();
    // Second call is idempotent
    sfx.startAmbientHum();
    expect(rig.oscillators.length).toBe(2);

    // Muting mid-round tears down active hum nodes
    sfx.setMuted(true);
    expect(rig.oscillators[0]!.stop).toHaveBeenCalled();
    rig.oscillators[0]!.onended?.();
    expect(rig.oscillators[0]!.disconnect).toHaveBeenCalled();
    expect(rig.oscillators[1]!.disconnect).toHaveBeenCalled();

    // Unmuting while round is still active restores hum
    sfx.setMuted(false);
    expect(rig.oscillators.length).toBe(4);

    // Stopping ambient hum clears desired state so later mute/unmute does NOT restart it
    sfx.stopAmbientHum();
    rig.oscillators[2]!.onended?.();
    expect(rig.oscillators[2]!.disconnect).toHaveBeenCalled();

    sfx.setMuted(true);
    sfx.setMuted(false);
    expect(rig.oscillators.length).toBe(4);
  });
});
