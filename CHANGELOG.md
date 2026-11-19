# Changelog

## Part A: Redesign integration

### A1. Integrate redesign and verify build
- Integrated the redesigned form UI, CCTV surveillance feed treatment, rubber-stamp slam sequence, evidence annotation callouts, self-hosted `@fontsource/courier-prime` and `@fontsource/archivo-narrow` fonts, and Poker Face hanging stamp / typewriter taunts / live case notes from `fleshcheck-codebase-redesign.zip`.
- Added `docs/voice.md` documenting the Office of Biological Verification voice rules.

### A2. Surveillance performance fallback and saturation probe
- Added `SurveillanceQualityMonitor` in `src/game/loop.ts` to automatically step down surveillance effects when active-round frames regularly exceed 24 ms (`full` -> `medium` skipping scanlines and `multiply` tint -> `low` also skipping radial vignette), and cached the radial vignette gradient per viewport size.
- Added `probeSaturationComposite()` in `src/game/loop.ts` so browsers where `globalCompositeOperation = "saturation"` fails to desaturate (e.g. iOS Safari quirks) automatically fall back to a plain semi-transparent grey overlay without using `ctx.filter`.
- Added unit tests for both helpers in `tests/loop.test.ts`.

## Part B: Feature passes

### B1. Sound pass
- Replaced and expanded procedural WebAudio SFX in `src/lib/sfx.ts` with filtered-noise + low sine drop (`92 Hz -> 45 Hz`) stamp thud, filtered-noise paper rustle on verdict reveal, rate-capped filtered-noise typewriter clacks, and a quiet fluorescent-style ambient hum faded in/out under calibration and active rounds.
- Added `typed?: number` to `ChallengeResult` and `playTypeClack` to `LoopCallbacks`, driving typewriter clacks every 3 revealed characters with rate capping.
- Ensured ambient hum respects live mute toggles and stops cleanly on verdict, abort, error, dev-switch, and pagehide, with full WebAudio node disconnection via `onended`.
- Added unit tests in `tests/sfx.test.ts` and `tests/loop.test.ts`.

### B2. Personalized copy
- Added `src/copy/template.ts` with pure `renderCopy(line, ctx)` and `buildCopyContext()` supporting `{weekday}`, `{time}`, `{streak}`, `{tries}`, `{lastResult}`, and `{case}` using only local case-file storage and the device clock, dropping lines cleanly when data is missing.
- Added 12 templated taunts across all three escalation tiers in `src/copy/poker-face.ts` (12 of 48 taunts = 25%).
- Persisted `lastResult` in `CaseFileStore` and passed local `copyContext` through `GameLoop` into challenges.
- Added unit tests in `tests/template.test.ts` and extended `tests/voice.test.ts` to render and lint every templated line across multiple contexts.

### B3. Pass twist: "too calm"
- Added `STAMPS_CALM` in `src/copy/global.ts` and `POKER_FACE_CALM_CALLOUTS` in `src/copy/poker-face.ts`, both enforced by `tests/voice.test.ts`.
- Tracked `maxLeakRatio` in `PokerFaceChallenge`; passing runs with `maxLeakRatio <= 0.15` (`TOO_CALM_THRESHOLD`) return `variant: "too-calm"`, a calm stamp override, and a matching finding callout while still counting as a 100% pass for streaks and sharing.
- Added `variant` and `stampText` override plumbing across `ChallengeResult`, `LoopVerdict`, `pickStampText`, `GameLoop` slam rendering, `renderEvidenceCard`, and `app.ts`.
- Added threshold-edge and stamp-override unit tests in `tests/stamp.test.ts`, `tests/challenges.test.ts`, and `tests/loop.test.ts`.

### B4. Unified HUD, THEME palette, and evidence marks across all challenges
- Extracted shared HUD helpers (`drawProgressLine`, `drawTimerTag`, `drawPromptStrip`, `clampEvidenceRect`) into `src/game/challenges/hud.ts` and migrated `POKER_FACE`, `NOSE_SPOON`, `BOT_DODGE`, `PASSPORT_PHOTO`, `MOUTH_CATCH`, `AFFECT_DEMO`, `INTERVIEW`, `NOSE_CURSOR`, `EYES_ON_FORM`, and `FULL_AUDIT` off hardcoded colors onto `THEME`, `FONT_TYPE`, and `FONT_LABEL`.
- Added per-challenge `ChallengeResult.evidence` marks on failure (including sub-round evidence reuse for `FULL_AUDIT`, rendered onto the captured sub-fail frame in `GameLoop`).
- Enabled `hideWireframe: true` across active face challenges in `src/game/registry.ts` so calibration keeps the wireframe while active rounds stay clean over the CCTV feed.
- Added per-challenge failure evidence mark and HUD draw tests in `tests/challenges.test.ts`.





