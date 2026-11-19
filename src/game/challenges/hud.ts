/**
 * Draws word-wrapped text centered vertically around `cy` within `maxWidth`.
 */
export function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  cy: number,
  maxWidth: number,
  lineHeight: number,
  maxLines?: number,
): void {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return;

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = probe;
    }
  }
  if (current) lines.push(current);

  const visible = maxLines !== undefined && lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const startY = cy - ((visible.length - 1) * lineHeight) / 2;
  for (let i = 0; i < visible.length; i++) {
    ctx.fillText(visible[i]!, x, startY + i * lineHeight, maxWidth);
  }
}
