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

export const STAMPS_CALM = [
  "CLEARED: FLAGGED FOR EXCESSIVE COMPOSURE",
  "CLEARED: SUSPICIOUSLY STILL",
  "CLEARED: BOT REVIEW PENDING",
  "CLEARED: UNNATURAL NEUTRALITY",
] as const;

export const STREAK_RANKS = [
  { minStreak: 30, title: "Permanent Desk Fixture" },
  { minStreak: 14, title: "Senior Biological Asset" },
  { minStreak: 7, title: "Verified Mammal" },
  { minStreak: 3, title: "Standard Human" },
  { minStreak: 1, title: "Provisional Human" },
  { minStreak: 0, title: "Applicant" },
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
  engineErrorTitle: "Verification failed: inspection booth offline.",
  engineErrorBody: "The on-device biometric runtime could not initialize in this browser.",
  webViewHint: "In-app browsers block camera access. Tap the menu and choose Open in browser.",
  caseFileEmpty: "No file on record.",
  colleagueBanner: (pct: number) => `A colleague scored ${pct}% human. Do better.`,
  nextCaseCountdown: (hhmmss: string) => `Next case opens in ${hhmmss} UTC.`,
  newCaseReady: (dayStr: string) => `Case #${dayStr} is now open for inspection.`,
} as const;
