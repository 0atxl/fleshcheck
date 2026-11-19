/**
 * Shared art direction for canvas drawing (HUD, stamps, evidence card).
 * The DOM palette in styles.css mirrors these values.
 */
export const THEME = {
  paper: "#E8E2D0",
  paperDeep: "#D8D0B8",
  paperLight: "#F3EFE2",
  ink: "#1A1A18",
  inkMuted: "#5B574B",
  formBlue: "#44609A",
  stampRed: "#B3261E",
  stampBlue: "#1F3F8F",
  screen: "#14130F",
} as const;

/** Typewriter face for filled-in data. Self-hosted via @fontsource. */
export const FONT_TYPE = '"Courier Prime", "Courier New", ui-monospace, monospace';
/** Condensed grotesque for printed form labels and stamps. Self-hosted via @fontsource. */
export const FONT_LABEL = '"Archivo Narrow", "Arial Narrow", system-ui, sans-serif';

/**
 * Canvas text only uses a webfont once it has loaded, otherwise it silently
 * falls back. Resolve after the faces load, or after a timeout so a font
 * failure never blocks the game.
 */
export function ensureFonts(timeoutMs = 1500): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) {
    return Promise.resolve();
  }
  const loads = Promise.all([
    document.fonts.load('400 16px "Courier Prime"'),
    document.fonts.load('700 16px "Courier Prime"'),
    document.fonts.load('500 16px "Archivo Narrow"'),
    document.fonts.load('700 16px "Archivo Narrow"'),
  ]).then(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });
  return Promise.race([loads.catch(() => undefined), timeout]);
}
