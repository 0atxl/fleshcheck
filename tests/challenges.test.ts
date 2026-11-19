import { describe, expect, it } from "vitest";
import { AFFECT_DEMO_COPY } from "../src/copy/affect-demo";
import { BOT_DODGE_COPY } from "../src/copy/bot-dodge";
import { EYES_ON_FORM_COPY } from "../src/copy/eyes-on-form";
import { FULL_AUDIT_COPY } from "../src/copy/full-audit";
import { INTERVIEW_COPY } from "../src/copy/interview";
import { MOUTH_CATCH_COPY } from "../src/copy/mouth-catch";
import { NOSE_CURSOR_COPY } from "../src/copy/nose-cursor";
import { NOSE_SPOON_COPY } from "../src/copy/nose-spoon";
import { PASSPORT_PHOTO_COPY } from "../src/copy/passport-photo";
import { POKER_FACE_COPY } from "../src/copy/poker-face";
import { AffectDemoChallenge, computeAffectProximity, matchesAffectPrompt } from "../src/game/challenges/affect-demo";
import { BotDodgeChallenge, computeStampOverlapRatio } from "../src/game/challenges/bot-dodge";
import { computeHorizontalGaze, EyesOnFormChallenge } from "../src/game/challenges/eyes-on-form";
import { FullAuditChallenge } from "../src/game/challenges/full-audit";
import { InterviewChallenge } from "../src/game/challenges/interview";
import { MouthCatchChallenge } from "../src/game/challenges/mouth-catch";
import { NoseCursorChallenge } from "../src/game/challenges/nose-cursor";
import { computeEyeRollRad, MAX_SPOON_ANGLE_RAD, NoseSpoonChallenge } from "../src/game/challenges/nose-spoon";
import { PassportPhotoChallenge } from "../src/game/challenges/passport-photo";
import { PokerFaceChallenge } from "../src/game/challenges/poker-face";
import type { Baseline, ChallengeManifest, FaceSignal } from "../src/game/types";
import { type BlendshapeMap, MEDIAPIPE_BLENDSHAPES } from "../src/vision/blendshapes";
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

function makeSpyCanvasContext(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const ctx = {
    save: () => {},
    restore: () => {},
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
    translate: () => {},
    rotate: () => {},
    setLineDash: () => {},
    measureText: (t: string) => ({ width: t.length * 7 }),
    fillText: (text: string) => {
      texts.push(text);
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe("MediaPipe model blendshape contract", () => {
  it("supports all 12 AFFECT_DEMO prompts using strictly valid 52-category MediaPipe blendshapes", () => {
    expect(MEDIAPIPE_BLENDSHAPES).toHaveLength(52);
    expect(MEDIAPIPE_BLENDSHAPES).not.toContain("tongueOut");

    const baseline = baseBaseline();
    const allPositive: BlendshapeMap = {};
    for (const key of MEDIAPIPE_BLENDSHAPES) {
      allPositive[key] = 0.5;
    }

    for (const prompt of AFFECT_DEMO_COPY.prompts ?? []) {
      expect(
        matchesAffectPrompt(prompt, makeFaceSignal({ shapes: allPositive }, baseline)),
        `Prompt "${prompt}" must be satisfiable using only the 52 MediaPipe blendshapes`,
      ).toBe(true);
    }
  });
});

describe("Phase 2 challenges", () => {
  it("NOSE_SPOON computes eye-corner roll, cancels resting eye tilt, and fails beyond 38 degrees", () => {
    const landmarks: { x: number; y: number }[] = [];
    landmarks[263] = { x: 260, y: 200 }; // screen-left eye outer corner
    landmarks[33] = { x: 380, y: 230 }; // screen-right eye outer corner lower => positive clockwise roll
    const eyeRoll = computeEyeRollRad({ landmarks, pose: { yaw: 0, pitch: 0, roll: 0 } });
    expect(eyeRoll).toBeGreaterThan(0.2);

    // Resting head tilt calibrated via eyeRollRad must NOT inject phantom torque even when pose.roll has opposite sign
    const tiltedBaseline: Baseline = {
      ...baseBaseline(),
      rollRad: -eyeRoll,
      eyeRollRad: eyeRoll,
    };
    const balancedSpoon = new NoseSpoonChallenge();
    balancedSpoon.init({
      seed: 101,
      baseline: tiltedBaseline,
      copy: NOSE_SPOON_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });
    const startAngle = balancedSpoon.getAngleRad();
    balancedSpoon.update(
      50,
      makeFaceSignal({ landmarks, pose: { yaw: 0, pitch: 0, roll: -eyeRoll } }, tiltedBaseline),
    );
    // Without resting-tilt cancellation, phantom deltaRoll = +2 * eyeRoll would swing angle sharply negative
    expect(Math.abs(balancedSpoon.getAngleRad() - startAngle)).toBeLessThan(0.02);

    const spoon = new NoseSpoonChallenge();
    const baseline = baseBaseline();
    spoon.init({
      seed: 101,
      baseline,
      copy: NOSE_SPOON_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    // Tilting strongly away from recovery destabilizes spoon past 38 deg
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
  it("NOSE_CURSOR avoids spawning traps on resting nose, honors entry grace, and handles dwell", () => {
    const baseline = baseBaseline();

    // Across 50 seeds, no trap may spawn within hitRadius * 1.6 of baseline nose
    for (let seed = 1; seed <= 50; seed++) {
      const probe = new NoseCursorChallenge();
      probe.init({
        seed,
        baseline,
        copy: NOSE_CURSOR_COPY,
        viewport: { width: 640, height: 480 },
        durationMs: 12_000,
      });
      const trap = probe.getTrapTarget()!;
      expect(Math.hypot(trap.x - baseline.nose.x, trap.y - baseline.nose.y)).toBeGreaterThan(64);
    }

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
    // Dwelling during the 650ms entry grace must NOT fail immediately
    for (let t = 0; t < 500; t += 50) {
      cursorTrap.update(50, makeFaceSignal({ nose: trap }, baseline));
    }
    expect(cursorTrap.getResult().status).toBe("running");

    // Continuing to dwell past entry grace fails
    for (let t = 0; t < 600; t += 50) {
      cursorTrap.update(50, makeFaceSignal({ nose: trap }, baseline));
      if (cursorTrap.getResult().status === "failed") break;
    }
    expect(cursorTrap.getResult().status).toBe("failed");
  });

  it("MOUTH_CATCH collects real spawned forms, is passable in 4s audit rounds, and fails on stamps", () => {
    const baseline = baseBaseline();

    // 4-second FULL_AUDIT pacing: catching spawned forms at low mouth y=330 passes comfortably
    const shortMc = new MouthCatchChallenge();
    shortMc.init({
      seed: 21,
      baseline,
      copy: MOUTH_CATCH_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 4_000,
    });

    for (let t = 0; t < 4_000; t += 50) {
      const form = shortMc.getActiveDocs().find((d) => d.kind === "form" && d.y >= 300);
      shortMc.update(
        50,
        makeFaceSignal(
          {
            mouth: form ? { x: form.x, y: 330 } : { x: 320, y: 330 },
            shapes: { ...baseline.shapes, jawOpen: form ? 0.35 : 0.05 },
          },
          baseline,
        ),
      );
      if (shortMc.getResult().status !== "running") break;
    }
    expect(shortMc.getResult().status).toBe("passed");

    // Swallowing a real spawned stamp fails
    const failMc = new MouthCatchChallenge();
    failMc.init({
      seed: 21,
      baseline,
      copy: MOUTH_CATCH_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });
    for (let t = 0; t < 4_000; t += 50) {
      const stamp = failMc.getActiveDocs().find((d) => d.kind === "stamp");
      failMc.update(
        50,
        makeFaceSignal(
          {
            mouth: stamp ? { x: stamp.x, y: stamp.y } : { x: 320, y: 300 },
            shapes: { ...baseline.shapes, jawOpen: stamp ? 0.35 : 0.05 },
          },
          baseline,
        ),
      );
      if (failMc.getResult().status !== "running") break;
    }
    expect(failMc.getResult().status).toBe("failed");
  });

  it("AFFECT_DEMO reports continuous proximity, matches recipes, emits milestones, and passes", () => {
    const baseline = baseBaseline();
    expect(
      computeAffectProximity("Inflated cheeks", makeFaceSignal({ shapes: { ...baseline.shapes, cheekPuff: 0.1 } }, baseline)),
    ).toBeCloseTo(0.5, 2);
    expect(matchesAffectPrompt("Inflated cheeks", makeFaceSignal({ shapes: { ...baseline.shapes, cheekPuff: 0.4 } }, baseline))).toBe(true);
    expect(matchesAffectPrompt("Sideways jaw", makeFaceSignal({ shapes: { ...baseline.shapes, jawLeft: 0.35 } }, baseline))).toBe(true);

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
        jawLeft: 0.4,
        browInnerUp: 0.4,
        browOuterUpLeft: 0.4,
        browDownLeft: 0.4,
        browDownRight: 0.4,
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
    expect(demo.getResult().milestones).toBe(4);
  });

  it("INTERVIEW requires neutral return between questions and enforces answer key", () => {
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

    // Advance past 250ms settle grace, then perform a clear pitch nod for Q1 (yes)
    for (let t = 0; t < 300; t += 50) {
      interview.update(50, makeFaceSignal({}, baseline));
    }
    interview.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0.25, roll: 0 } }, baseline));
    expect(interview.getResult().progress).toBeCloseTo(0.5, 2);

    // Still holding Q1's nod at t=350ms of Q2 must NOT false-fail Q2 before returning to neutral
    for (let t = 0; t < 350; t += 50) {
      interview.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0.24, roll: 0 } }, baseline));
    }
    expect(interview.getResult().status).toBe("running");

    // Return to neutral, then shake head "no" => passes Q2!
    interview.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0.02, roll: 0 } }, baseline));
    interview.update(50, makeFaceSignal({ pose: { yaw: 0.26, pitch: 0.02, roll: 0 } }, baseline));
    expect(interview.getResult().status).toBe("passed");

    // Wrong answer after returning to neutral DOES fail
    const interviewFail = new InterviewChallenge();
    interviewFail.init({
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
    for (let t = 0; t < 300; t += 50) interviewFail.update(50, makeFaceSignal({}, baseline));
    interviewFail.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0.25, roll: 0 } }, baseline));
    for (let t = 0; t < 300; t += 50) interviewFail.update(50, makeFaceSignal({}, baseline));
    interviewFail.update(50, makeFaceSignal({ pose: { yaw: 0, pitch: 0.25, roll: 0 } }, baseline));
    expect(interviewFail.getResult().status).toBe("failed");
  });

  it("EYES_ON_FORM uses subject-anatomical horizontal gaze and detects head-turn bypasses", () => {
    // Looking toward screen-left = subject's anatomical left (eyeLookOutLeft + eyeLookInRight)
    const leftGaze = computeHorizontalGaze({ eyeLookOutLeft: 0.5, eyeLookInRight: 0.5 });
    expect(leftGaze.lookLeft).toBeCloseTo(0.5, 4);
    expect(leftGaze.lookRight).toBe(0);

    const baseline = baseBaseline();
    const eyes = new EyesOnFormChallenge();
    eyes.init({
      seed: 55,
      baseline,
      copy: EYES_ON_FORM_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    while (!eyes.getActivePopup() && eyes.getResult().status === "running") {
      eyes.update(50, makeFaceSignal({}, baseline));
    }
    const active = eyes.getActivePopup()!;
    expect(active).not.toBeNull();
    expect(eyes.getResult().status).toBe("running");

    // Glance anatomically toward the active popup's side for >300ms
    const gazeShapes =
      active.side === "left"
        ? { ...baseline.shapes, eyeLookOutLeft: 0.45, eyeLookInRight: 0.45 }
        : { ...baseline.shapes, eyeLookOutRight: 0.45, eyeLookInLeft: 0.45 };

    for (let t = 0; t < 350; t += 50) {
      eyes.update(50, makeFaceSignal({ shapes: gazeShapes }, baseline));
      if (eyes.getResult().status === "failed") break;
    }
    expect(eyes.getResult().status).toBe("failed");

    // Turning whole head away while keeping eye blendshapes centered also fails
    const eyesYaw = new EyesOnFormChallenge();
    eyesYaw.init({
      seed: 55,
      baseline,
      copy: EYES_ON_FORM_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });
    for (let t = 0; t < 400; t += 50) {
      eyesYaw.update(50, makeFaceSignal({ pose: { yaw: 0.35, pitch: 0, roll: 0 } }, baseline));
      if (eyesYaw.getResult().status === "failed") break;
    }
    expect(eyesYaw.getResult().status).toBe("failed");
  });
});

describe("Phase 4 FULL_AUDIT challenge", () => {
  it("picks 3 distinct challenges, preserves pause badges, defers intermission draw by 1 frame, and runs all 3 rounds", () => {
    const baseline = baseBaseline();
    const candidates: ChallengeManifest[] = [
      {
        id: "POKER_FACE",
        title: "Poker Face",
        department: "Affect Review",
        prompt: "Hold neutral.",
        model: "face",
        durationMs: 12_000,
        enabled: true,
        copy: POKER_FACE_COPY,
        create: () => new PokerFaceChallenge(),
      },
      {
        id: "PASSPORT_PHOTO",
        title: "Passport Photo",
        department: "Identity Imaging",
        prompt: "Hold still.",
        model: "face",
        durationMs: 12_000,
        enabled: true,
        copy: PASSPORT_PHOTO_COPY,
        create: () => new PassportPhotoChallenge(),
      },
      {
        id: "EYES_ON_FORM",
        title: "Eyes on Form",
        department: "Attention Audit",
        prompt: "Look forward.",
        model: "face",
        durationMs: 12_000,
        enabled: true,
        copy: EYES_ON_FORM_COPY,
        create: () => new EyesOnFormChallenge(),
      },
    ];

    const audit = new FullAuditChallenge(() => candidates);
    audit.init({
      seed: 100,
      baseline,
      copy: FULL_AUDIT_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    const pickedIds = new Set(audit.getSubManifests().map((m) => m.id));
    expect(pickedIds.size).toBe(3);

    // Pause during Round 1, then smile hard to fail Round 1
    audit.onPause();
    let checkedFailFrameDraw = false;

    for (let step = 0; step < 320; step++) {
      const prevRounds = audit.getResult().roundRecords?.length ?? 0;
      const smile = prevRounds === 0 ? 0.7 : 0.05;
      audit.update(
        50,
        makeFaceSignal({ shapes: { ...baseline.shapes, mouthSmileLeft: smile, mouthSmileRight: smile } }, baseline),
      );
      const nextRounds = audit.getResult().roundRecords?.length ?? 0;

      if (prevRounds === 0 && nextRounds === 1 && !checkedFailFrameDraw) {
        checkedFailFrameDraw = true;
        // Immediate draw on fail tick must render the sub-challenge (not the STATION intermission curtain)
        const failDraw = makeSpyCanvasContext();
        audit.draw(failDraw.ctx, { width: 640, height: 480 });
        expect(failDraw.texts.some((t) => t.startsWith("STATION 1 OF 3"))).toBe(false);

        // Next draw tick renders the intermission curtain
        const intermissionDraw = makeSpyCanvasContext();
        audit.draw(intermissionDraw.ctx, { width: 640, height: 480 });
        expect(intermissionDraw.texts.some((t) => t.startsWith("STATION 1 OF 3: REJECTED"))).toBe(true);
      }

      if (audit.getResult().status !== "running") break;
    }

    expect(checkedFailFrameDraw).toBe(true);
    const res = audit.getResult();
    expect(res.status).toBe("failed");
    expect(res.roundRecords).toHaveLength(3);
    expect(res.roundRecords?.[0]?.passed).toBe(false);
    expect(res.roundRecords?.[0]?.paused).toBe(true);
    expect(res.roundRecords?.[1]?.passed).toBe(true);
    expect(res.roundRecords?.[1]?.paused).toBe(false);
    expect(res.roundRecords?.[2]?.passed).toBe(true);
    expect(res.progress).toBeLessThan(1);
  });
});
