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
