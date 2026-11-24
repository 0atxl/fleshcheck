import type { CopyBank } from "../game/types";

export const POKER_FACE_COPY: CopyBank = {
  callouts: [
    "EMOTIONAL LEAK DETECTED",
    "UNAUTHORIZED MIRTH",
    "COMPOSURE BREACH",
    "FACIAL DRIFT RECORDED",
    "SMILE INDICATED ON FORM 27-B",
    "UNAPPROVED CHEEK MOTION",
    "AFFECT THRESHOLD EXCEEDED",
    "LEVITY VIOLATION LOGGED",
    "NEUTRALITY WITHDRAWN",
    "EXPRESSION FILED AS HOSTILE",
  ],
  taunts: [
    // Tier 1: plausible administrative observations (0 - 15; 4 templated)
    "Maintain a neutral face for the record.",
    "This inspection is routine and mildly inconvenient.",
    "It is {time} on a {weekday}. Of course you are here.",
    "You appear unusually tense for a Tuesday.",
    "Please stop rehearsing what you meant to say earlier.",
    "Case {case} is now open. Keep your mouth level.",
    "Your posture suggests three unread voicemails.",
    "Do not adjust your chair to look more confident.",
    "The form notes that you blinked defensively.",
    "Your previous file lists compliance as '{lastResult}'.",
    "Calm down. Nobody asked about your dentist.",
    "Your eyebrows are negotiating without permission.",
    "Hold still while we verify your mammal status.",
    "Prior filings on record: {tries}. Standard procedure still applies.",
    "Look less like you just forgot why you opened the fridge.",
    "You are breathing like someone checking a bank balance.",

    // Tier 2: petty personal assumptions (16 - 31; 4 templated)
    "You definitely said 'you too' when the waiter said enjoy.",
    "Your forehead remembers every email you sent at midnight.",
    "You look unusually defensive for {time} on a {weekday}.",
    "You look like someone who waves back at strangers waving behind you.",
    "Stop thinking about that haircut from four years ago.",
    "Your recorded streak of {streak} has not visibly relaxed your jaw.",
    "You still have five reusable bags in the trunk, unused.",
    "This is the exact face you make on mute during group calls.",
    "You rehearse restaurant orders in your head and still point.",
    "Prior desk outcome: {lastResult}. Your face suggests no lessons were learned.",
    "Your expression says you already lost the receipt.",
    "You pushed a pull door this week and pretended to check your phone.",
    "You owe at least one text message an apology.",
    "Attempt history stands at {tries}. The office expected steadier cheeks by now.",
    "Your jaw just remembered an unanswered calendar invite.",
    "You looked in the mirror before leaving and trusted the hallway light.",

    // Tier 3: surreal bureaucratic dread (32 - 47; 4 templated)
    "Form 27-B already knows what you did with the extra ketchup.",
    "The clerk has been deadpan since 1994 and finds you theatrical.",
    "On a {weekday} at {time}, the hallway fluorescent knows your posture by name.",
    "Do not smile at the fluorescent ceiling. It is not your friend.",
    "A committee has voted to describe your chin as indecisive.",
    "Case {case} has been pre-stamped in pencil out of professional pessimism.",
    "Your left cheek is applying for a separate permit.",
    "Please stop radiating mild guilt toward the webcam.",
    "Somewhere a filing cabinet just sighed at your face.",
    "A compliance streak of {streak} is still subject to sudden revocation by desk four.",
    "Section 9 forbids remembering embarrassing high school speeches.",
    "Your reflection has been placed on administrative leave.",
    "The stamp is already inked. Only your mouth can delay it.",
    "The archive notes your last composure reading as '{lastResult}' and has dimmed the lights.",
    "Three clerks are reviewing whether your face counts as luggage.",
    "Remain blank. Enthusiasm is grounds for secondary screening.",
  ],
};

/**
 * Case notes the office types about the subject while the round runs.
 * Triggered by small movements well below the fail threshold, so the player
 * feels watched. Sentence case, no exclamation marks.
 */
export const POKER_FACE_NOTES = {
  blink: ["Blink recorded.", "Second blink recorded. Pattern forming.", "Blink noted. Frequency concerning."],
  brow: [
    "Brow movement noted.",
    "Eyebrow activity logged without authorization.",
    "Brow position has changed since intake.",
  ],
  mouth: [
    "Mouth corner deviation noted.",
    "Upward drift at the mouth logged.",
    "Lip activity noted. Cause requested.",
  ],
  cheek: ["Cheek pressure logged.", "Cheek activity noted. Cause unclear."],
  jaw: ["Jaw movement noted.", "Jaw tension logged."],
  head: ["Head position questioned.", "Subject has shifted. Reason requested."],
} as const;

/** Finding lines used when a subject passes Poker Face with suspiciously low facial drift. */
export const POKER_FACE_CALM_CALLOUTS = [
  "EXCESSIVE COMPOSURE LOGGED ON FORM 27-B",
  "ZERO AFFECT DETECTED. BOT REVIEW FILED",
  "SUSPICIOUSLY STILL. REFERRED TO DESK FOUR",
] as const;
