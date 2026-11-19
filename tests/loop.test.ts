import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { afterEach, describe, expect, it } from "vitest";
import { FULL_AUDIT_COPY } from "../src/copy/full-audit";
import { POKER_FACE_COPY } from "../src/copy/poker-face";
import { FullAuditChallenge } from "../src/game/challenges/full-audit";
import { PokerFaceChallenge } from "../src/game/challenges/poker-face";
import {
  GameLoop,
  probeSaturationComposite,
  SLAM_APPROACH_MS,
  SLAM_TOTAL_FAIL_MS,
  SurveillanceQualityMonitor,
  type LoopVerdict,
} from "../src/game/loop";
import type { Challenge, ChallengeManifest, ChallengeResult } from "../src/game/types";
import { FaceTracker } from "../src/vision/tracker";

interface FakeCanvas {
  width: number;
  height: number;
  drawCalls: string[];
  getContext(): CanvasRenderingContext2D;
}

function makeFakeCanvas(width = 640, height = 480): FakeCanvas {
  const drawCalls: string[] = [];
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    setLineDash: () => {},
    drawImage: () => {
      drawCalls.push("drawImage");
    },
    measureText: (t: string) => ({ width: t.length * 7 }),
    fillText: (text: string) => {
      drawCalls.push(`text:${text}`);
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;

  return {
    width,
    height,
    drawCalls,
    getContext: () => ctx,
  };
}

function makeFaceResult(smile: number): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  landmarks[1] = { x: 0.5, y: 0.5, z: 0, visibility: 1 };
  landmarks[13] = { x: 0.5, y: 0.6, z: 0, visibility: 1 };
  landmarks[14] = { x: 0.5, y: 0.62, z: 0, visibility: 1 };
  landmarks[33] = { x: 0.4, y: 0.4, z: 0, visibility: 1 };
  landmarks[263] = { x: 0.6, y: 0.4, z: 0, visibility: 1 };
  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [
      {
        categories: [
          { index: 0, score: smile, categoryName: "mouthSmileLeft", displayName: "" },
          { index: 1, score: smile, categoryName: "mouthSmileRight", displayName: "" },
        ],
        headIndex: 0,
        headName: "",
      },
    ],
    facialTransformationMatrixes: [
      {
        rows: 4,
        columns: 4,
        data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    ],
  };
}

const origDoc = globalThis.document;
const origRaf = globalThis.requestAnimationFrame;
const origCaf = globalThis.cancelAnimationFrame;

afterEach(() => {
  globalThis.document = origDoc;
  globalThis.requestAnimationFrame = origRaf;
  globalThis.cancelAnimationFrame = origCaf;
});

function installLoopHarness() {
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;

  globalThis.document = {
    createElement: () => makeFakeCanvas(),
  } as unknown as Document;

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    queue.delete(id);
  };

  return {
    step(nowMs: number) {
      const entries = [...queue.entries()];
      queue.clear();
      for (const [, cb] of entries) {
        cb(nowMs);
      }
    },
    pendingCount: () => queue.size,
  };
}

describe("GameLoop integration", () => {
  it("reports true active elapsedMs and holds the stamp slam before firing onVerdict", () => {
    const harness = installLoopHarness();
    const stageCanvas = makeFakeCanvas() as unknown as HTMLCanvasElement;
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;

    const landmarker = {
      detectForVideo: () => makeFaceResult(0.05),
    } as unknown as FaceLandmarker;

    // Custom completion-based challenge that fails at 1000ms with 25% progress
    let activeMs = 0;
    const quickFailManifest: ChallengeManifest = {
      id: "MOUTH_CATCH",
      title: "Quick Fail",
      department: "Test",
      prompt: "Test.",
      model: "face",
      durationMs: 12_000,
      enabled: true,
      copy: { callouts: ["FAIL"] },
      create: (): Challenge => ({
        init() {
          activeMs = 0;
        },
        update(dtMs) {
          activeMs += dtMs;
        },
        draw() {},
        getResult(): ChallengeResult {
          return activeMs >= 1_000
            ? { status: "failed", progress: 0.25, callout: "FAIL" }
            : { status: "running", progress: 0.25 };
        },
      }),
    };

    let verdict: LoopVerdict | null = null;
    let thuds = 0;
    const loop = new GameLoop(
      stageCanvas,
      video,
      new FaceTracker(landmarker),
      quickFailManifest,
      1,
      {
        onPhaseChange() {},
        onVerdict(v) {
          verdict = v;
        },
        playStampThud() {
          thuds += 1;
        },
      },
      false, // reducedMotion = false => stamp slam sequence enabled
    );

    loop.start();
    let now = performance.now();

    // Calibrate for 1600ms (CALIBRATION_MS = 1500)
    for (let i = 0; i < 32; i++) {
      now += 50;
      harness.step(now);
    }

    // Run active round until challenge triggers fail at 1000ms
    for (let i = 0; i < 20; i++) {
      now += 50;
      harness.step(now);
    }

    // The thud is synced to the stamp landing, not the fail frame, and the verdict waits for the slam
    expect(thuds).toBe(0);
    expect(verdict).toBeNull();
    expect(harness.pendingCount()).toBe(1);

    // Step to just past the impact
    const impactSteps = Math.ceil(SLAM_APPROACH_MS / 50) + 1;
    for (let i = 0; i < impactSteps; i++) {
      now += 50;
      harness.step(now);
    }
    expect(thuds).toBe(1);
    expect(verdict).toBeNull();

    // Advance through the rest of the slam
    const totalSteps = Math.ceil(SLAM_TOTAL_FAIL_MS / 50) + 2;
    for (let i = 0; i < totalSteps; i++) {
      now += 50;
      harness.step(now);
      if (verdict) break;
    }

    expect(thuds).toBe(1);
    expect(verdict).not.toBeNull();
    // Real active elapsedMs is ~1000ms (NOT fabricated 0.25 * 12000 = 3000ms!)
    expect(verdict!.elapsedMs).toBeGreaterThanOrEqual(950);
    expect(verdict!.elapsedMs).toBeLessThanOrEqual(1150);
  });

  it("does not double-fire playStampThud when Station 3 fails in FULL_AUDIT", () => {
    const harness = installLoopHarness();
    const stageCanvas = makeFakeCanvas() as unknown as HTMLCanvasElement;
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;

    let smileScore = 0.05;
    const landmarker = {
      detectForVideo: () => makeFaceResult(smileScore),
    } as unknown as FaceLandmarker;

    const sub: ChallengeManifest = {
      id: "POKER_FACE",
      title: "Poker Face",
      department: "Affect Review",
      prompt: "Hold neutral.",
      model: "face",
      durationMs: 12_000,
      enabled: true,
      copy: POKER_FACE_COPY,
      create: () => new PokerFaceChallenge(),
    };
    const sub2: ChallengeManifest = { ...sub, id: "PASSPORT_PHOTO", department: "Identity" };
    const sub3: ChallengeManifest = { ...sub, id: "EYES_ON_FORM", department: "Attention" };

    const auditManifest: ChallengeManifest = {
      id: "FULL_AUDIT",
      title: "Full Audit",
      department: "Annual Audit",
      prompt: "Three rounds.",
      model: "face",
      durationMs: 9_000, // 3s per station
      maxTries: 1,
      enabled: true,
      copy: FULL_AUDIT_COPY,
      create: () => new FullAuditChallenge(() => [sub, sub2, sub3]),
    };

    let verdict: LoopVerdict | null = null;
    let thuds = 0;
    let advances = 0;

    const loop = new GameLoop(
      stageCanvas,
      video,
      new FaceTracker(landmarker),
      auditManifest,
      7,
      {
        onPhaseChange() {},
        onVerdict(v) {
          verdict = v;
        },
        playStampThud() {
          thuds += 1;
        },
        playRoundAdvance() {
          advances += 1;
        },
      },
      true, // reducedMotion = true => immediate verdict callback
    );

    loop.start();
    let now = performance.now();

    // Calibrate neutral
    for (let i = 0; i < 32; i++) {
      now += 50;
      harness.step(now);
    }

    // Pass Station 1 and Station 2 neutrally, then smile hard during Station 3
    for (let step = 0; step < 260; step++) {
      smileScore = advances >= 2 ? 0.85 : 0.05;
      now += 50;
      harness.step(now);
      if (verdict) break;
    }

    expect(verdict).not.toBeNull();
    expect(verdict!.passed).toBe(false);
    expect(advances).toBe(2);
    // Only ONE stamp thud for Station 3 failure (not double-fired!)
    expect(thuds).toBe(1);
  });

  it("fires playMilestone for intermediate challenge milestones without double-firing on pass", () => {
    const harness = installLoopHarness();
    const stageCanvas = makeFakeCanvas() as unknown as HTMLCanvasElement;
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;
    const landmarker = {
      detectForVideo: () => makeFaceResult(0.05),
    } as unknown as FaceLandmarker;

    let stepCount = 0;
    const milestoneManifest: ChallengeManifest = {
      id: "NOSE_CURSOR",
      title: "Milestone Test",
      department: "Test",
      prompt: "Test.",
      model: "face",
      durationMs: 12_000,
      enabled: true,
      copy: { callouts: ["FAIL"] },
      create: (): Challenge => ({
        init() {
          stepCount = 0;
        },
        update() {
          stepCount += 1;
        },
        draw() {},
        getResult(): ChallengeResult {
          if (stepCount >= 3) return { status: "passed", progress: 1, milestones: 3 };
          return { status: "running", progress: stepCount / 3, milestones: stepCount };
        },
      }),
    };

    let milestonesPlayed = 0;
    let passesPlayed = 0;
    const loop = new GameLoop(
      stageCanvas,
      video,
      new FaceTracker(landmarker),
      milestoneManifest,
      1,
      {
        onPhaseChange() {},
        onVerdict() {},
        playMilestone() {
          milestonesPlayed += 1;
        },
        playPassChime() {
          passesPlayed += 1;
        },
      },
      true,
    );

    loop.start();
    let now = performance.now();
    for (let i = 0; i < 36; i++) {
      now += 50;
      harness.step(now);
    }

    // Milestones 1 & 2 chime while running; final milestone 3 triggers pass chime only
    expect(milestonesPlayed).toBe(2);
    expect(passesPlayed).toBe(1);
  });

  it("steps down surveillance quality full -> medium -> low when frames regularly exceed 24 ms", () => {
    const monitor = new SurveillanceQualityMonitor();
    expect(monitor.level).toBe("full");

    // Smooth 16 ms frames keep quality at full
    for (let i = 0; i < 32; i++) {
      monitor.record(16);
    }
    expect(monitor.level).toBe("full");

    // Occasional slow spikes do not trigger fallback
    for (let i = 0; i < 16; i++) {
      monitor.record(i % 4 === 0 ? 35 : 16);
    }
    expect(monitor.level).toBe("full");

    // Sustained >24 ms frames step down to medium (skips scanlines + multiply)
    for (let i = 0; i < 16; i++) {
      monitor.record(30);
    }
    expect(monitor.level).toBe("medium");

    // Still >24 ms after step-down drops vignette as well
    for (let i = 0; i < 16; i++) {
      monitor.record(28);
    }
    expect(monitor.level).toBe("low");

    monitor.reset();
    expect(monitor.level).toBe("full");
  });

  it("detects broken saturation composite support via probeSaturationComposite", () => {
    // Working saturation desaturates #ff0000 to neutral grey (~76,76,76)
    globalThis.document = {
      createElement: () => ({
        width: 2,
        height: 2,
        getContext: () => ({
          fillStyle: "",
          globalCompositeOperation: "source-over",
          globalAlpha: 1,
          fillRect: () => {},
          getImageData: () => ({ data: new Uint8ClampedArray([76, 76, 76, 255]) }),
        }),
      }),
    } as unknown as Document;
    expect(probeSaturationComposite()).toBe(true);

    // Broken saturation leaves red unchanged
    globalThis.document = {
      createElement: () => ({
        width: 2,
        height: 2,
        getContext: () => ({
          fillStyle: "",
          globalCompositeOperation: "source-over",
          globalAlpha: 1,
          fillRect: () => {},
          getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255]) }),
        }),
      }),
    } as unknown as Document;
    expect(probeSaturationComposite()).toBe(false);
  });

  it("fires playTypeClack as PokerFace types out taunts at a capped rate", () => {
    const harness = installLoopHarness();
    const stageCanvas = makeFakeCanvas() as unknown as HTMLCanvasElement;
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;
    const landmarker = {
      detectForVideo: () => makeFaceResult(0.02),
    } as unknown as FaceLandmarker;

    const pokerManifest: ChallengeManifest = {
      id: "POKER_FACE",
      title: "Poker Face",
      department: "Affect Review",
      prompt: "Hold neutral.",
      model: "face",
      durationMs: 12_000,
      hideWireframe: true,
      enabled: true,
      copy: POKER_FACE_COPY,
      create: () => new PokerFaceChallenge(),
    };

    let clacks = 0;
    const loop = new GameLoop(
      stageCanvas,
      video,
      new FaceTracker(landmarker),
      pokerManifest,
      1,
      {
        onPhaseChange() {},
        onVerdict() {},
        playTypeClack() {
          clacks += 1;
        },
      },
      true,
    );

    loop.start();
    let now = performance.now();
    // Still calibrating at 1450 ms -> zero clacks
    for (let i = 0; i < 29; i++) {
      now += 50;
      harness.step(now);
    }
    expect(clacks).toBe(0);

    // Finish calibration + run 1500 ms of active typing
    for (let i = 0; i < 33; i++) {
      now += 50;
      harness.step(now);
    }
    expect(clacks).toBeGreaterThanOrEqual(5);
    expect(clacks).toBeLessThanOrEqual(25);
    loop.stop();
  });
});
