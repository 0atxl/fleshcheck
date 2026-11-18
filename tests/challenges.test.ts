import { describe, expect, it } from "vitest";
import { AFFECT_DEMO_COPY } from "../src/copy/affect-demo";
import { BOT_DODGE_COPY } from "../src/copy/bot-dodge";
import { EYES_ON_FORM_COPY } from "../src/copy/eyes-on-form";
import { INTERVIEW_COPY } from "../src/copy/interview";
import { MOUTH_CATCH_COPY } from "../src/copy/mouth-catch";
import { NOSE_CURSOR_COPY } from "../src/copy/nose-cursor";
import { NOSE_SPOON_COPY } from "../src/copy/nose-spoon";
import { PASSPORT_PHOTO_COPY } from "../src/copy/passport-photo";
import { AffectDemoChallenge, matchesAffectPrompt } from "../src/game/challenges/affect-demo";
import { BotDodgeChallenge, computeStampOverlapRatio } from "../src/game/challenges/bot-dodge";
import { EyesOnFormChallenge } from "../src/game/challenges/eyes-on-form";
import { InterviewChallenge } from "../src/game/challenges/interview";
import { MouthCatchChallenge } from "../src/game/challenges/mouth-catch";
import { NoseCursorChallenge } from "../src/game/challenges/nose-cursor";
import { computeEyeRollRad, MAX_SPOON_ANGLE_RAD, NoseSpoonChallenge } from "../src/game/challenges/nose-spoon";
import { PassportPhotoChallenge } from "../src/game/challenges/passport-photo";
import type { Baseline, FaceSignal } from "../src/game/types";
import { computeBlendshapeDeltas } from "../src/vision/calibration";

function baseBaseline(): Baseline {
  return {
    shapes: { mouthSmileLeft: 0.05, mouthSmileRight: 0.05, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 },
    nose: { x: 320, y: 240 },
    rollRad: 0,
    yawRad: 0,
    pitchRad: 0,
  };
}

function makeFaceSignal(overrides: Partial<FaceSignal> = {}, baseline = baseBaseline()): FaceSignal {
  const shapes = overrides.shapes ?? { ...baseline.shapes };
  return {
    t: overrides.t ?? 1000,
    tracked: overrides.tracked ?? true,
    shapes,
    delta: overrides.delta ?? computeBlendshapeDeltas(shapes, baseline.shapes),
    nose: overrides.nose ?? { x: 320, y: 240 },
    mouth: overrides.mouth ?? { x: 320, y: 300 },
    faceBox: overrides.faceBox ?? { x: 240, y: 140, w: 160, h: 200 },
    pose: overrides.pose ?? { yaw: 0, pitch: 0, roll: 0 },
    landmarks: overrides.landmarks ?? [],
  };
}

describe("Phase 2 challenges", () => {
  it("NOSE_SPOON computes eye-corner roll and fails when tipped beyond 38 degrees", () => {
    const landmarks: { x: number; y: number }[] = [];
    landmarks[263] = { x: 260, y: 200 }; // screen-left eye outer corner
    landmarks[33] = { x: 380, y: 230 }; // screen-right eye outer corner lower => positive clockwise roll
    expect(computeEyeRollRad({ landmarks, pose: { yaw: 0, pitch: 0, roll: 0 } })).toBeGreaterThan(0.2);

    const spoon = new NoseSpoonChallenge();
    const baseline = baseBaseline();
    spoon.init({
      seed: 101,
      baseline,
      copy: NOSE_SPOON_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    // Tilting strongly in the same direction as the spoon lean destabilizes it past 38 deg
    for (let t = 0; t < 4000; t += 50) {
      const leanDir = spoon.getAngleRad() >= 0 ? -1 : 1;
      spoon.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0, roll: leanDir * 0.6 } }, baseline));
      if (spoon.getResult().status === "failed") break;
    }

    expect(spoon.getResult().status).toBe("failed");
    expect(Math.abs(spoon.getAngleRad())).toBeGreaterThan(MAX_SPOON_ANGLE_RAD);
  });

  it("BOT_DODGE detects >35% stamp overlap and fails after entry grace", () => {
    const ratioClear = computeStampOverlapRatio(
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 250, y: 200, w: 160, h: 200 },
    );
    expect(ratioClear).toBe(0);

    const ratioHit = computeStampOverlapRatio(
      { x: 260, y: 220, w: 100, h: 50 },
      { x: 240, y: 140, w: 160, h: 200 },
    );
    expect(ratioHit).toBe(1);

    const dodge = new BotDodgeChallenge();
    const baseline = baseBaseline();
    dodge.init({
      seed: 7,
      baseline,
      copy: BOT_DODGE_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    // Advance past 700ms grace and place faceBox directly over stamp
    for (let t = 0; t < 900; t += 50) {
      const stamp = dodge.getStampRect();
      dodge.update(
        50,
        makeFaceSignal({ faceBox: { x: stamp.x - 10, y: stamp.y - 10, w: 180, h: 200 } }, baseline),
      );
      if (dodge.getResult().status === "failed") break;
    }
    expect(dodge.getResult().status).toBe("failed");
  });

  it("PASSPORT_PHOTO allows brief blinks, fails held eye closure (>600ms), and fails head tilt", () => {
    const baseline = baseBaseline();
    const passport = new PassportPhotoChallenge();
    passport.init({
      seed: 9,
      baseline,
      copy: PASSPORT_PHOTO_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    // Normal 200ms blink followed by open eyes should remain running
    for (let t = 0; t < 200; t += 50) {
      passport.update(
        50,
        makeFaceSignal(
          { shapes: { ...baseline.shapes, eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 } },
          baseline,
        ),
      );
    }
    for (let t = 0; t < 400; t += 50) {
      passport.update(50, makeFaceSignal({}, baseline));
    }
    expect(passport.getResult().status).toBe("running");

    // Holding eyes shut for 700ms triggers REJECTED: EYES
    for (let t = 0; t < 700; t += 50) {
      passport.update(
        50,
        makeFaceSignal(
          { shapes: { ...baseline.shapes, eyeBlinkLeft: 0.85, eyeBlinkRight: 0.85 } },
          baseline,
        ),
      );
      if (passport.getResult().status === "failed") break;
    }
    expect(passport.getResult().status).toBe("failed");
    expect(passport.getResult().callout).toBe("REJECTED: EYES");

    // Head tilt >10 degrees triggers REJECTED: HEAD LEVEL
    const passportTilt = new PassportPhotoChallenge();
    passportTilt.init({
      seed: 10,
      baseline,
      copy: PASSPORT_PHOTO_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });
    for (let t = 0; t < 300; t += 50) {
      passportTilt.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0, roll: 0.35 } }, baseline));
    }
    expect(passportTilt.getResult().status).toBe("failed");
    expect(passportTilt.getResult().callout).toBe("REJECTED: HEAD LEVEL");
  });
});

describe("Phase 3 challenges", () => {
  it("NOSE_CURSOR ticks ordered targets via dwell and fails when dwelling on a trap", () => {
    const baseline = baseBaseline();
    const cursorPass = new NoseCursorChallenge();
    cursorPass.init({
      seed: 12,
      baseline,
      copy: NOSE_CURSOR_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    for (let step = 0; step < 3; step++) {
      const target = cursorPass.getActiveTarget()!;
      expect(target).not.toBeNull();
      for (let t = 0; t < 650; t += 50) {
        cursorPass.update(50, makeFaceSignal({ nose: target }, baseline));
        if (cursorPass.getResult().status === "passed") break;
      }
    }
    expect(cursorPass.getResult().status).toBe("passed");

    const cursorTrap = new NoseCursorChallenge();
    cursorTrap.init({
      seed: 12,
      baseline,
      copy: NOSE_CURSOR_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });
    const trap = cursorTrap.getTrapTarget()!;
    for (let t = 0; t < 450; t += 50) {
      cursorTrap.update(50, makeFaceSignal({ nose: trap }, baseline));
    }
    expect(cursorTrap.getResult().status).toBe("failed");
  });

  it("MOUTH_CATCH collects falling forms and fails if swallowing a stamp", () => {
    const baseline = baseBaseline();
    const mc = new MouthCatchChallenge();
    mc.init({
      seed: 21,
      baseline,
      copy: MOUTH_CATCH_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    mc.spawnForTest("form", 320, 295);
    mc.update(50, makeFaceSignal({ mouth: { x: 320, y: 300 }, shapes: { ...baseline.shapes, jawOpen: 0.35 } }, baseline));
    expect(mc.getResult().progress).toBeGreaterThan(0);
    expect(mc.getResult().status).toBe("running");

    mc.spawnForTest("stamp", 320, 295);
    mc.update(50, makeFaceSignal({ mouth: { x: 320, y: 300 }, shapes: { ...baseline.shapes, jawOpen: 0.35 } }, baseline));
    expect(mc.getResult().status).toBe("failed");
  });

  it("AFFECT_DEMO matches expression recipes and passes when all prompts are held", () => {
    const baseline = baseBaseline();
    expect(matchesAffectPrompt("Inflated cheeks", makeFaceSignal({ shapes: { ...baseline.shapes, cheekPuff: 0.4 } }, baseline))).toBe(true);
    expect(matchesAffectPrompt("Visible tongue", makeFaceSignal({ shapes: { ...baseline.shapes, tongueOut: 0.5 } }, baseline))).toBe(true);

    const demo = new AffectDemoChallenge();
    demo.init({
      seed: 33,
      baseline,
      copy: AFFECT_DEMO_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    for (let slot = 0; slot < 4; slot++) {
      const prompt = demo.getCurrentPrompt();
      expect(prompt.length).toBeGreaterThan(0);
      const matchingShapes = {
        ...baseline.shapes,
        mouthFrownLeft: 0.4,
        mouthFrownRight: 0.4,
        eyeWideLeft: 0.4,
        eyeWideRight: 0.4,
        jawOpen: 0.4,
        browInnerUp: 0.4,
        browOuterUpLeft: 0.4,
        browDownLeft: 0.4,
        browDownRight: 0.4,
        tongueOut: 0.5,
        mouthSmileLeft: 0.4,
        mouthSmileRight: 0.4,
        cheekPuff: 0.4,
        mouthPucker: 0.4,
      };
      for (let t = 0; t < 450; t += 50) {
        demo.update(50, makeFaceSignal({ shapes: matchingShapes }, baseline));
        if (demo.getCurrentPrompt() !== prompt || demo.getResult().status === "passed") break;
      }
    }
    expect(demo.getResult().status).toBe("passed");
  });

  it("INTERVIEW distinguishes nod vs shake answers and enforces answer key", () => {
    const baseline = baseBaseline();
    const interview = new InterviewChallenge();
    interview.init({
      seed: 44,
      baseline,
      copy: {
        callouts: INTERVIEW_COPY.callouts,
        questions: [
          { text: "Were you born on Earth.", answer: "yes" },
          { text: "Are you currently a microwave.", answer: "no" },
        ],
      },
      viewport: { width: 640, height: 480 },
      durationMs: 4_800,
    });

    // Advance past 220ms settle grace, then perform a clear pitch nod for Q1 (yes)
    for (let t = 0; t < 300; t += 50) {
      interview.update(50, makeFaceSignal({}, baseline));
    }
    interview.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0.25, roll: 0 } }, baseline));
    expect(interview.getResult().progress).toBeCloseTo(0.5, 2);

    // Advance past Q2 settle grace, then nod AGAIN on a "no" question => fail
    for (let t = 0; t < 300; t += 50) {
      interview.update(50, makeFaceSignal({}, baseline));
    }
    interview.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0.25, roll: 0 } }, baseline));
    expect(interview.getResult().status).toBe("failed");
  });

  it("EYES_ON_FORM stays running when looking straight and fails on sustained glance at active popup", () => {
    const baseline = baseBaseline();
    const eyes = new EyesOnFormChallenge();
    eyes.init({
      seed: 55,
      baseline,
      copy: EYES_ON_FORM_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    // Advance until first popup is active while looking centered
    while (!eyes.getActivePopup() && eyes.getResult().status === "running") {
      eyes.update(50, makeFaceSignal({}, baseline));
    }
    const active = eyes.getActivePopup()!;
    expect(active).not.toBeNull();
    expect(eyes.getResult().status).toBe("running");

    // Look directly toward the active popup's side for >300ms
    const gazeShapes =
      active.side === "left"
        ? { ...baseline.shapes, eyeLookOutRight: 0.45, eyeLookInLeft: 0.45 }
        : { ...baseline.shapes, eyeLookOutLeft: 0.45, eyeLookInRight: 0.45 };

    for (let t = 0; t < 400; t += 50) {
      eyes.update(50, makeFaceSignal({ shapes: gazeShapes }, baseline));
      if (eyes.getResult().status === "failed") break;
    }
    expect(eyes.getResult().status).toBe("failed");
  });
});
