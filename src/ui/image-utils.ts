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
 * Never logged. Falls back to a deterministic non-cryptographic fingerprint
 * when Web Crypto is unavailable, so cache identity is never silently blank.
 */
export async function computeContentFingerprint(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const _crypto = globalThis.crypto;
  if (_crypto?.subtle) {
    try {
      const hashBuf = await _crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Some non-secure/embedded browser contexts expose crypto but reject
      // subtle.digest. Cache correctness still needs a content-derived key.
    }
  }

  // Non-cryptographic fallback for cache identity only. FNV-1a 64-bit keeps
  // uploads working in older/non-secure contexts instead of silently returning
  // an empty fingerprint (which would reintroduce the stale-AI-cache bug).
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64-${hash.toString(16).padStart(16, '0')}-${bytes.byteLength}`;
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

export function fitDimensions(w: number, h: number, maxEdge: number): { width: number; height: number } {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h };
  const ratio = w / h;
  if (w >= h) return { width: maxEdge, height: Math.round(maxEdge / ratio) };
  return { width: Math.round(maxEdge * ratio), height: maxEdge };
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

/**
 * Generate a favicon from a local file without leaking its temporary blob URL.
 * Both upload-screen and review-screen favicon inputs use this helper so their
 * lifecycle behavior cannot drift apart.
 */
export async function generateFaviconFromFile(file: File, size = 256): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await generateFaviconDataUrl(objectUrl, size);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
