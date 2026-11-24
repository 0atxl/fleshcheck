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

### B5. Intro View Transition: checkbox grows into camera
- Added `canUseViewTransition`, `runSharedElementTransition`, and `skipActiveViewTransition` in `src/ui/transitions.ts` using `document.startViewTransition` with a dynamically assigned unique `view-transition-name: booth-portal` handed off strictly between `#captcha-widget` and `#stage-canvas`.
- Kept the checked checkbox visible alongside the inline typed loading status while camera permission and MediaPipe initialize, morphing directly into the camera stage on ready (and back on withdraw), while preserving `sessionToken` abort guards, focus routing after transition completion, reduced-motion / unsupported-browser fallbacks, and error handling on denied camera.
- Added aspect-ratio clipping (`height: 100%; overflow: clip`) and reduced-motion rules for `::view-transition-*` in `src/ui/styles.css`.
- Added unit tests in `tests/transitions.test.ts`.

### B6. Optional polish: local streak rank titles
- Added `STREAK_RANKS` (`Applicant`, `Provisional Human`, `Standard Human`, `Verified Mammal`, `Senior Biological Asset`, `Permanent Desk Fixture`) in `src/copy/global.ts` and pure `getStreakRank()` in `src/game/scoring.ts`.
- Persisted rank locally in `CaseFileStore` and surfaced it in the intro meta row, personnel case file dialog, and evidence card (`CLASSIFICATION` field).
- Covered all rank titles in `tests/voice.test.ts` and added rank progression/persistence tests in `tests/scoring.test.ts`.

## Part C: Production launch prep (Vercel)

### C1. Vercel headers, OG metadata, and launch hygiene
- Added `vercel.json` mirroring every security and caching header from `public/_headers` (CSP, `X-Frame-Options`, COOP, CORP, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options`, `/og-card.png` `cross-origin` CORP + 24h cache, and immutable `/assets/(.*)` cache) while keeping `public/_headers` intact for local E2E verification.
- Added `"engines": { "node": ">=22.12.0" }` to `package.json` for Vite 8 / Vitest 5 / Vercel Node runtime compatibility.
- Updated `index.html` with absolute `https://fleshcheck.vercel.app` Open Graph, Twitter Card, and canonical URLs (keeping `LAUNCH_EPOCH_UTC` at `2026-11-18`).
- Redesigned `public/og-card.png` (1200×630) in the warm archival paper bureaucratic form palette (`THEME`, `Archivo Narrow`, `Courier Prime`, checkbox declaration, OBV seal, and distressed red rubber stamp) following `docs/voice.md`.
- Added first-party Vercel Web Analytics (`@vercel/analytics`) via `src/lib/analytics.ts` and `src/main.ts`, enabled in production on deployed hosts (uses same-origin `/_vercel/insights/*` under the existing strict CSP; stays silent on local dev/preview/E2E loopback hosts).
- Fixed `.btn[hidden]` CSS specificity in `src/ui/styles.css` so hidden verdict buttons (`#retry-try`, `#share-native`, `#download-clip`, `#reload-next-case`) actually hide, and ensured post-reload live verdict ties capture the live snapshot in `src/ui/app.ts`; added computed-display assertion in `scripts/smoke-e2e.mjs`.
- Fixed right-edge text clipping on the evidence card (`src/output/evidence-card.ts` + `src/ui/app.ts`) by fitting the title and `100% HUMAN` readout cleanly within the right column and re-rendering once self-hosted webfonts finish loading; added unit coverage in `tests/evidence-card.test.ts`.
- Opened all 10 compliance challenges to all users in production via the new **Inspection Roster** bar (`src/ui/roster.ts`), clickable **Personnel Case File** folders, `?challenge=<ID>` deep links, and a verdict **Next inspection** button (removing the dev-only switcher gate in `src/ui/dev-switcher.ts`).
- Removed untracked `fleshcheck-codebase.zip` and added `*.zip` to `.gitignore`.
