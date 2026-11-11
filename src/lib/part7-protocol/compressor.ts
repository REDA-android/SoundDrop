/**
 * Hybrid Compression Engine for Acoustic Channels
 * Selects between fflate GZIP/Deflate and lz-string to minimize acoustic symbol count.
 */

import { deflateSync, inflateSync, gzipSync, gunzipSync } from 'fflate';
import LZString from 'lz-string';

export interface CompressionResult {
  data: Uint8Array;
  isCompressed: boolean;
  algorithm: 'raw' | 'deflate' | 'lz-string';
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
}

export function compressAcousticPayload(input: Uint8Array | string): CompressionResult {
  const rawBytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const originalSize = rawBytes.length;

  if (originalSize <= 20) {
    return {
      data: rawBytes,
      isCompressed: false,
      algorithm: 'raw',
      originalSize,
      compressedSize: originalSize,
      savingsPercent: 0,
    };
  }

  let bestData = rawBytes;
  let bestAlgo: 'raw' | 'deflate' | 'lz-string' = 'raw';
  let bestSize = originalSize;

  // 1. Try fflate Deflate
  try {
    const deflated = deflateSync(rawBytes, { level: 9 });
    if (deflated.length < bestSize) {
      bestData = deflated;
      bestAlgo = 'deflate';
      bestSize = deflated.length;
    }
  } catch (err) {
    console.warn('Deflate compression failed:', err);
  }

  // 2. If input is string or small JSON, try lz-string UTF-16/Base64
  if (typeof input === 'string') {
    try {
      const lz = LZString.compressToUint8Array(input);
      if (lz && lz.length < bestSize) {
        bestData = lz;
        bestAlgo = 'lz-string';
        bestSize = lz.length;
      }
    } catch {
      // Ignore
    }
  }

  const savings = Math.max(0, Math.round(((originalSize - bestSize) / originalSize) * 100));

  return {
    data: bestData,
    isCompressed: bestAlgo !== 'raw',
    algorithm: bestAlgo,
    originalSize,
    compressedSize: bestSize,
    savingsPercent: savings,
  };
}

export function decompressAcousticPayload(
  data: Uint8Array,
  isCompressed: boolean,
  isStringHint = false
): Uint8Array {
  if (!isCompressed) return data;

  // 1. Try Deflate/GZIP inflate
  try {
    return inflateSync(data);
  } catch {
    try {
      return gunzipSync(data);
    } catch {
      // 2. Try lz-string if string hint
      if (isStringHint) {
        try {
          const lzDecomp = LZString.decompressFromUint8Array(data);
          if (lzDecomp) {
            return new TextEncoder().encode(lzDecomp);
          }
        } catch {
          // Fall through
        }
      }
    }
  }

  return data;
}
