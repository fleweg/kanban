// Browser-only image resize + square center-crop helper. Uses a
// canvas so we don't pull a runtime dep into the bundle for what's
// essentially a 30-line operation.
//
// Strategy:
//   1. decodeImage(file) → HTMLImageElement, via createImageBitmap
//      where available (cheap, decodes off the main thread) or
//      URL.createObjectURL + <img onload> fallback.
//   2. Compute the square crop region: smallest of width/height
//      centred on the source.
//   3. Draw onto a `size × size` canvas with imageSmoothingQuality
//      = "high" so the downsample doesn't look like a mosaic.
//   4. canvas.toBlob('image/jpeg', quality) → Blob.
//
// The output is always JPEG: smaller than PNG for photos, broader
// support than WebP, and the avatar is rendered through a CSS round
// mask so transparency is irrelevant.

export interface ResizeOptions {
  // Target side length of the square output. The avatar is rendered at
  // most ~36 px in the UI (lg size) — we ship 256 px so it stays sharp
  // on retina and leaves headroom for future bigger formats.
  size?: number;
  // JPEG quality, 0–1. 0.85 keeps the file ~15–30 KB for a typical
  // 256×256 photograph — small enough to ignore on a mobile network.
  quality?: number;
  // Maximum accepted input file size. Anything bigger is rejected before
  // we even try to decode (decoding 50 MB photos in JS is slow and
  // sometimes OOMs mobile Safari).
  maxInputBytes?: number;
}

export const DEFAULT_AVATAR_SIZE = 256;
export const DEFAULT_AVATAR_QUALITY = 0.85;
export const MAX_AVATAR_INPUT_BYTES = 5 * 1024 * 1024; // 5 MB

export interface ResizeResult {
  blob: Blob;
  width: number;
  height: number;
  contentType: string;
}

// Returns a JPEG Blob of the input cropped to a centred square and
// scaled to `size × size`. Throws on decode failure or invalid input.
export async function resizeToSquareJpeg(
  file: File,
  options: ResizeOptions = {},
): Promise<ResizeResult> {
  const size = options.size ?? DEFAULT_AVATAR_SIZE;
  const quality = options.quality ?? DEFAULT_AVATAR_QUALITY;
  const maxBytes = options.maxInputBytes ?? MAX_AVATAR_INPUT_BYTES;

  if (!file.type.startsWith("image/")) {
    throw new Error(`Not an image: ${file.type || "unknown type"}.`);
  }
  if (file.size > maxBytes) {
    throw new Error(
      `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB > ${(
        maxBytes /
        1024 /
        1024
      ).toFixed(0)} MB).`,
    );
  }

  const bitmap = await decodeImage(file);
  try {
    const { sx, sy, sSize } = squareCropRegion(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sSize, sSize, 0, 0, size, size);

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    return { blob, width: size, height: size, contentType: "image/jpeg" };
  } finally {
    // ImageBitmap exposes .close(); HTMLImageElement doesn't need it.
    if ("close" in bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

// Compute the centred square sub-region of an image. Returns the
// source coordinates and side length to pass to drawImage.
function squareCropRegion(w: number, h: number): { sx: number; sy: number; sSize: number } {
  const sSize = Math.min(w, h);
  const sx = Math.floor((w - sSize) / 2);
  const sy = Math.floor((h - sSize) / 2);
  return { sx, sy, sSize };
}

// Returns an ImageBitmap when supported, otherwise a fully-loaded
// HTMLImageElement. Both expose width/height + can be passed to
// CanvasRenderingContext2D.drawImage.
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the URL-based path. Some browsers refuse
      // certain ICO / SVG variants via createImageBitmap.
    }
  }
  return loadImageFromUrl(URL.createObjectURL(file));
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Release the blob URL — the bitmap is now in memory.
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image."));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob returned null."));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}
