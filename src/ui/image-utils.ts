/**
 * image-utils.ts — Client-side image resize/compress utilities.
 * Uses the Canvas API — no external dependencies.
 */

// ---------------------------------------------------------------------------
// Artwork ID allocator — monotonic, session-scoped, never reuses an id
// even after removals.
// ---------------------------------------------------------------------------

let _nextArtworkSeq = 1;

/**
 * Allocate the next artwork id in the form `aw-NN`.
 * Never derived from array length, so deleting an artwork cannot create
 * a collision when a new file is uploaded later in the same session.
 */
export function allocateArtworkId(): string {
  const seq = _nextArtworkSeq++;
  return `aw-${String(seq).padStart(2, '0')}`;
}

/** Reset the allocator — test-only. */
export function _resetArtworkIdAllocator(next = 1): void {
  _nextArtworkSeq = next;
}

// ---------------------------------------------------------------------------
// Content fingerprint — SHA-256 via Web Crypto (browser-native)
// ---------------------------------------------------------------------------

/**
 * Compute a hex-encoded SHA-256 fingerprint of a File's bytes.
 * Used by aiInputKey() to detect same-filename/different-content replacements.
 * Never logged. Returns empty string if Web Crypto is unavailable.
 */
export async function computeContentFingerprint(file: File): Promise<string> {
  const _crypto = globalThis.crypto;
  if (!_crypto?.subtle) return '';
  const buf = await file.arrayBuffer();
  const hashBuf = await _crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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
 *
 * @deprecated Use createDisplayBlobUrl() instead. This variant passes the
 *   original (potentially huge) file directly to Three.js and the exporter,
 *   which violates the ≤2048px display-copy contract. Retained only for
 *   portrait uploads where we do not downscale.
 */
export function createDisplayObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * Resize an image file to at most 2048px on its longest edge, then return
 * a persistent object URL for a JPEG Blob.
 *
 * - Aspect ratio is preserved.
 * - Images smaller than 2048px on every edge are NOT upscaled.
 * - The caller is responsible for revoking the returned URL with
 *   URL.revokeObjectURL() when the artwork is removed.
 */
export async function createDisplayBlobUrl(file: File, maxEdge = 2048, quality = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const tempUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(tempUrl); // revoke temporary load URL
      const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, maxEdge);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not get 2D context')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error(`Failed to encode display image: ${file.name}`)); return; }
          resolve(URL.createObjectURL(blob));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(tempUrl); reject(new Error(`Failed to load image: ${file.name}`)); };
    img.src = tempUrl;
  });
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
