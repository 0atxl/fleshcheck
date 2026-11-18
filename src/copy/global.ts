export const STAMPS_REJECT = [
  "REJECTED: SUSPECTED BOT",
  "REJECTED: INSUFFICIENT COMPOSURE",
  "REJECTED: PAPERWORK INCOMPLETE",
  "REJECTED: CONDUCT UNCLEAR",
  "REJECTED: UNVERIFIED MAMMAL",
  "REJECTED: SECTION 4 VIOLATION",
  "REJECTED: EXCESSIVE HUMANITY",
  "REJECTED: AUTOMATION SUSPECTED",
  "REJECTED: REFILING REQUIRED",
  "REJECTED: BIOMETRIC MISMATCH",
] as const;

export const STAMPS_PASS = [
  "PROVISIONALLY HUMAN",
  "CLEARED FOR NOW",
  "TEMPORARILY BIOLOGICAL",
  "ADEQUATE CARBON",
  "PERMITTED TO PROCEED",
  "PASS: UNDER REVIEW",
] as const;

export const STALLING_LINES = [
  "Locating chin.",
  "Verifying mammal status.",
  "Filing Form 27-B.",
  "Measuring compliance aura.",
  "Checking for aluminum.",
  "Consulting the department binder.",
  "Recording neutral posture.",
] as const;

export const UI_COPY = {
  agency: "Office of Biological Verification",
  formCode: "Form OBV-01",
  checkboxLabel: "Verify you are human",
  privacyNotice: "100% on-device inspection. Zero video frames leave your browser.",
  noFleshTitle: "Verification failed: no flesh detected.",
  noFleshBody: "No live camera feed was provided to the clerk.",
  webViewHint: "In-app browsers block camera access. Tap the menu and choose Open in browser.",
  caseFileEmpty: "No file on record.",
  colleagueBanner: (pct: number) => `A colleague scored ${pct}% human. Do better.`,
} as const;
