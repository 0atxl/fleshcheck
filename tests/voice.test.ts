import { describe, expect, it } from "vitest";
import { AFFECT_DEMO_COPY } from "../src/copy/affect-demo";
import { BOT_DODGE_COPY } from "../src/copy/bot-dodge";
import { EYES_ON_FORM_COPY } from "../src/copy/eyes-on-form";
import { FULL_AUDIT_COPY } from "../src/copy/full-audit";
import { STALLING_LINES, STAMPS_PASS, STAMPS_REJECT, UI_COPY } from "../src/copy/global";
import { INTERVIEW_COPY } from "../src/copy/interview";
import { MOUTH_CATCH_COPY } from "../src/copy/mouth-catch";
import { NOSE_CURSOR_COPY } from "../src/copy/nose-cursor";
import { NOSE_SPOON_COPY } from "../src/copy/nose-spoon";
import { PASSPORT_PHOTO_COPY } from "../src/copy/passport-photo";
import { POKER_FACE_COPY, POKER_FACE_NOTES } from "../src/copy/poker-face";
import { CHALLENGES } from "../src/game/registry";

const BANNED_PATTERN = /\b(oops|uh-oh|nice try|awesome|epic|level up|gamify)\b/i;
const DEV_JARGON_PATTERN = /\b(commit|git|wip|pull request|deploy|localhost|regex)\b/i;

function gatherAllStrings(): string[] {
  const strings: string[] = [
    ...STAMPS_REJECT,
    ...STAMPS_PASS,
    ...STALLING_LINES,
    UI_COPY.agency,
    UI_COPY.formCode,
    UI_COPY.checkboxLabel,
    UI_COPY.privacyNotice,
    UI_COPY.noFleshTitle,
    UI_COPY.noFleshBody,
    UI_COPY.engineErrorTitle,
    UI_COPY.engineErrorBody,
    UI_COPY.webViewHint,
    UI_COPY.caseFileEmpty,
    UI_COPY.colleagueBanner(31),
    UI_COPY.nextCaseCountdown("04:12:09"),
    UI_COPY.newCaseReady("02"),
    ...Object.values(POKER_FACE_NOTES).flat(),
    ...(POKER_FACE_COPY.taunts ?? []),
    ...POKER_FACE_COPY.callouts,
    ...(NOSE_SPOON_COPY.commentary ?? []),
    ...NOSE_SPOON_COPY.callouts,
    ...BOT_DODGE_COPY.callouts,
    ...(PASSPORT_PHOTO_COPY.rules ?? []),
    ...PASSPORT_PHOTO_COPY.callouts,
    ...(MOUTH_CATCH_COPY.forms ?? []),
    ...MOUTH_CATCH_COPY.callouts,
    ...(AFFECT_DEMO_COPY.prompts ?? []),
    ...AFFECT_DEMO_COPY.callouts,
    ...(INTERVIEW_COPY.questions?.map((q) => q.text) ?? []),
    ...INTERVIEW_COPY.callouts,
    ...(NOSE_CURSOR_COPY.checkboxes?.map((b) => b.label) ?? []),
    ...NOSE_CURSOR_COPY.callouts,
    ...(EYES_ON_FORM_COPY.popups ?? []),
    ...EYES_ON_FORM_COPY.callouts,
    ...(FULL_AUDIT_COPY.transitions ?? []),
    ...FULL_AUDIT_COPY.callouts,
  ];

  for (const c of CHALLENGES) {
    strings.push(c.title, c.department, c.prompt);
  }
  return strings;
}

describe("voice bible enforcement", () => {
  it("contains zero exclamation marks, banned words, or developer-only jokes", () => {
    for (const line of gatherAllStrings()) {
      expect(line, `Exclamation mark found in: "${line}"`).not.toContain("!");
      expect(line, `Banned word found in: "${line}"`).not.toMatch(BANNED_PATTERN);
      expect(line, `Developer jargon found in: "${line}"`).not.toMatch(DEV_JARGON_PATTERN);
    }
  });
});
