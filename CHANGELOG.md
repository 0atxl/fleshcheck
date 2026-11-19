# Changelog

## Part A: Redesign integration

### A1. Integrate redesign and verify build
- Integrated the redesigned form UI, CCTV surveillance feed treatment, rubber-stamp slam sequence, evidence annotation callouts, self-hosted `@fontsource/courier-prime` and `@fontsource/archivo-narrow` fonts, and Poker Face hanging stamp / typewriter taunts / live case notes from `fleshcheck-codebase-redesign.zip`.
- Added `docs/voice.md` documenting the Office of Biological Verification voice rules.

### A2. Surveillance performance fallback and saturation probe
- Added `SurveillanceQualityMonitor` in `src/game/loop.ts` to automatically step down surveillance effects when active-round frames regularly exceed 24 ms (`full` -> `medium` skipping scanlines and `multiply` tint -> `low` also skipping radial vignette), and cached the radial vignette gradient per viewport size.
- Added `probeSaturationComposite()` in `src/game/loop.ts` so browsers where `globalCompositeOperation = "saturation"` fails to desaturate (e.g. iOS Safari quirks) automatically fall back to a plain semi-transparent grey overlay without using `ctx.filter`.
- Added unit tests for both helpers in `tests/loop.test.ts`.

