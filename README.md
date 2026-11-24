# fleshcheck

Browser-based biometric compliance game from the Office of Biological Verification. Ten 12-second webcam checks run entirely on-device using MediaPipe `FaceLandmarker` WebAssembly—zero video frames or facial landmarks leave your browser.

Live deployment: https://fleshcheck.vercel.app

## What it includes

- **Ten compliance checks**: Poker Face, Nose Spoon, Bot Dodge, Passport Photo, Mouth Catch, Affect Demo, Interview, Nose Cursor, Eyes on Form, and Full Audit.
- **Daily case + open inspection roster**: Play the deterministic UTC daily case or pick any challenge from the Inspection Roster (or `?challenge=<ID>`).
- **Local case file & evidence output**: Saves daily tries, streaks, ranks, and department verdicts in `localStorage`, and generates downloadable PNG evidence cards and failure clips.
- **Strict client-side privacy**: Runs `@mediapipe/tasks-vision` and bundled fonts locally under strict Content-Security-Policy headers.

## Scripts

```bash
npm install
npm run dev       # Start local Vite dev server
npm test          # Run Vitest unit suite
npm run build     # Type-check and build dist/
npm run preview   # Preview production build
npm run test:e2e  # Run Playwright smoke check against dist/
```

Requires Node.js `>=22.12.0`.
