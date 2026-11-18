const MAX_CANVAS_AREA = 5e7; // Mobile Safari canvas backing limit safety

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (canvas.width * canvas.height > MAX_CANVAS_AREA) {
    return Promise.reject(new Error("Canvas exceeds maximum safe export area"));
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("PNG encoding failed"));
      }
    }, "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
