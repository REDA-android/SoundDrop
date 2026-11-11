/**
 * Progressive Image Preparation Engine
 * Generates compact 28-byte BlurHash for Packet 0 + Client-side WebP compression.
 */

import { encode as encodeBlurHash, decode as decodeBlurHash } from 'blurhash';

export interface PreparedImageDrop {
  blurHash: string;
  compressedBytes: Uint8Array;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
}

/**
 * Extracts pixels via HTML5 Canvas, generates 28-byte BlurHash, and creates compressed WebP
 */
export async function prepareImageForAcousticDrop(file: File): Promise<PreparedImageDrop> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const maxDim = 320; // Micro dimension for acoustic transfer
      let w = img.width;
      let h = img.height;

      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Cannot get 2D canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);

      // 1. Generate 28-character BlurHash (component size 4x3)
      const blurHash = encodeBlurHash(imageData.data, w, h, 4, 3);

      // 2. Export compressed WebP Blob
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            reject(new Error('WebP blob creation failed'));
            return;
          }
          const arrayBuffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);

          resolve({
            blurHash,
            compressedBytes: bytes,
            mimeType: 'image/webp',
            originalSize: file.size,
            compressedSize: bytes.length,
            width: w,
            height: h,
          });
        },
        'image/webp',
        0.65 // 65% quality for ultra-compact acoustic transfer
      );
    };

    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

/**
 * Decodes BlurHash to a Data URL for instant AirDrop bubble preview
 */
export function renderBlurHashToDataUrl(blurHash: string, width = 64, height = 64): string {
  try {
    const pixels = decodeBlurHash(blurHash, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL();
  } catch {
    return '';
  }
}
