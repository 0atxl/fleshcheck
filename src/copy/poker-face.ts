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
    // Tier 1: plausible administrative observations (0 - 11)
    "Maintain a neutral face for the record.",
    "This inspection is routine and mildly inconvenient.",
    "You appear unusually tense for a Tuesday.",
    "Please stop rehearsing what you meant to say earlier.",
    "Your posture suggests three unread voicemails.",
    "Do not adjust your chair to look more confident.",
    "The form notes that you blinked defensively.",
    "Calm down. Nobody asked about your dentist.",
    "Your eyebrows are negotiating without permission.",
    "Hold still while we verify your mammal status.",
    "Look less like you just forgot why you opened the fridge.",
    "You are breathing like someone checking a bank balance.",

    // Tier 2: petty personal assumptions (12 - 23)
    "You definitely said 'you too' when the waiter said enjoy.",
    "Your forehead remembers every email you sent at midnight.",
    "You look like someone who waves back at strangers waving behind you.",
    "Stop thinking about that haircut from four years ago.",
    "You still have five reusable bags in the trunk, unused.",
    "This is the exact face you make on mute during group calls.",
    "You rehearse restaurant orders in your head and still point.",
    "Your expression says you already lost the receipt.",
    "You pushed a pull door this week and pretended to check your phone.",
    "You owe at least one text message an apology.",
    "Your jaw just remembered an unanswered calendar invite.",
    "You looked in the mirror before leaving and trusted the hallway light.",

    // Tier 3: surreal bureaucratic dread (24 - 35)
    "Form 27-B already knows what you did with the extra ketchup.",
    "The clerk has been deadpan since 1994 and finds you theatrical.",
    "Do not smile at the fluorescent ceiling. It is not your friend.",
    "A committee has voted to describe your chin as indecisive.",
    "Your left cheek is applying for a separate permit.",
    "Please stop radiating mild guilt toward the webcam.",
    "Somewhere a filing cabinet just sighed at your face.",
    "Section 9 forbids remembering embarrassing high school speeches.",
    "Your reflection has been placed on administrative leave.",
    "The stamp is already inked. Only your mouth can delay it.",
    "Three clerks are reviewing whether your face counts as luggage.",
    "Remain blank. Enthusiasm is grounds for secondary screening.",
  ],
};

/**
 * Case notes the office types about the subject while the round runs.
 * Triggered by small movements well below the fail threshold, so the player
 * feels watched. Sentence case, no exclamation marks (see docs/voice.md).
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
