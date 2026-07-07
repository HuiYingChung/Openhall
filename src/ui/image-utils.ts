/**
 * image-utils.ts — Client-side image resize/compress utilities.
 * Uses the Canvas API — no external dependencies.
 */

/** Resize an image blob to fit within maxEdge pixels (longest side), returning a data URL. */
export async function resizeToDataUrl(
  file: File,
  maxEdge: number,
  quality = 0.85
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, maxEdge);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not get 2D context')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ dataUrl, width, height });
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(`Failed to load image: ${file.name}`)); };
    img.src = objectUrl;
  });
}

/** Read the natural dimensions of a file without resizing. */
export async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(objectUrl); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(`Failed to load: ${file.name}`)); };
    img.src = objectUrl;
  });
}

function fitDimensions(w: number, h: number, maxEdge: number): { width: number; height: number } {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h };
  const ratio = w / h;
  if (w >= h) return { width: maxEdge, height: Math.round(maxEdge / ratio) };
  return { width: Math.round(maxEdge * ratio), height: maxEdge };
}

/**
 * Create a persistent object URL for displaying a file in the viewer.
 * The caller is responsible for calling URL.revokeObjectURL when done.
 */
export function createDisplayObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * Generate a square favicon from any image URL (blob:, data:, or same-origin
 * path). Center-crops to a square ("cover" fit) and returns a PNG data URL.
 * Used at export time to give a self-hosted gallery a browser-tab icon derived
 * from the first artwork when the artist hasn't uploaded a custom favicon.
 */
export async function generateFaviconDataUrl(sourceUrl: string, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Allow drawing cross-origin/same-origin images to the canvas without taint.
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not get 2D context')); return; }
      // Cover-crop: scale so the shorter edge fills the square, center the rest.
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - s) / 2;
      const sy = (img.naturalHeight - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error(`Failed to load image for favicon: ${sourceUrl}`));
    img.src = sourceUrl;
  });
}
