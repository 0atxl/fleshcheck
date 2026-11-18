import { DEFAULT_DURATION_MS } from "../config";
import { AFFECT_DEMO_COPY } from "../copy/affect-demo";
import { BOT_DODGE_COPY } from "../copy/bot-dodge";
import { EYES_ON_FORM_COPY } from "../copy/eyes-on-form";
import { INTERVIEW_COPY } from "../copy/interview";
import { MOUTH_CATCH_COPY } from "../copy/mouth-catch";
import { NOSE_CURSOR_COPY } from "../copy/nose-cursor";
import { NOSE_SPOON_COPY } from "../copy/nose-spoon";
import { PASSPORT_PHOTO_COPY } from "../copy/passport-photo";
import { POKER_FACE_COPY } from "../copy/poker-face";
import { AffectDemoChallenge } from "./challenges/affect-demo";
import { BotDodgeChallenge } from "./challenges/bot-dodge";
import { EyesOnFormChallenge } from "./challenges/eyes-on-form";
import { InterviewChallenge } from "./challenges/interview";
import { MouthCatchChallenge } from "./challenges/mouth-catch";
import { NoseCursorChallenge } from "./challenges/nose-cursor";
import { NoseSpoonChallenge } from "./challenges/nose-spoon";
import { PassportPhotoChallenge } from "./challenges/passport-photo";
import { PokerFaceChallenge } from "./challenges/poker-face";
import type { ChallengeManifest } from "./types";

export const CHALLENGES: ChallengeManifest[] = [
  {
    id: "POKER_FACE",
    title: "Poker Face",
    department: "Affect Review",
    prompt: "Maintain a neutral expression during compliance review.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: POKER_FACE_COPY,
    create: () => new PokerFaceChallenge(),
  },
  {
    id: "NOSE_SPOON",
    title: "Nose Spoon",
    department: "Asset Handling",
    prompt: "Balance the regulation spoon. The egg is a federal asset.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: NOSE_SPOON_COPY,
    create: () => new NoseSpoonChallenge(),
  },
  {
    id: "BOT_DODGE",
    title: "Bot Dodge",
    department: "Designations",
    prompt: "Avoid the BOT? designation.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: BOT_DODGE_COPY,
    create: () => new BotDodgeChallenge(),
  },
  {
    id: "PASSPORT_PHOTO",
    title: "Passport Photo",
    department: "Identity Imaging",
    prompt: "Hold still for your official photograph.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: PASSPORT_PHOTO_COPY,
    create: () => new PassportPhotoChallenge(),
  },
  {
    id: "MOUTH_CATCH",
    title: "Mouth Catch",
    department: "Intake",
    prompt: "Submit your documents. Orally.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: MOUTH_CATCH_COPY,
    create: () => new MouthCatchChallenge(),
  },
  {
    id: "AFFECT_DEMO",
    title: "Affect Demo",
    department: "Expression Standards",
    prompt: "Demonstrate the following emotional states.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: AFFECT_DEMO_COPY,
    create: () => new AffectDemoChallenge(),
  },
  {
    id: "INTERVIEW",
    title: "Interview",
    department: "Verbal Compliance",
    prompt: "Answer yes or no. Nod or shake.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: INTERVIEW_COPY,
    create: () => new InterviewChallenge(),
  },
  {
    id: "NOSE_CURSOR",
    title: "Nose Cursor",
    department: "Input Devices",
    prompt: "Your pointing device has been confiscated.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: NOSE_CURSOR_COPY,
    create: () => new NoseCursorChallenge(),
  },
  {
    id: "EYES_ON_FORM",
    title: "Eyes on Form",
    department: "Attention Audit",
    prompt: "Keep your eyes on the form. Disregard all distractions.",
    model: "face",
    durationMs: DEFAULT_DURATION_MS,
    enabled: true,
    copy: EYES_ON_FORM_COPY,
    create: () => new EyesOnFormChallenge(),
  },
];

export const ACTIVE_CHALLENGES: ChallengeManifest[] = CHALLENGES.filter((c) => c.enabled);
