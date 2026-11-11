/**
 * Compression Engine for Acoustic Payloads
 * Utilizes fflate for fast Deflate/GZIP compression with zero-overhead fallback.
 */

import { deflateSync, inflateSync, gzipSync, gunzipSync } from 'fflate';

export interface CompressionResult {
  data: Uint8Array;
  isCompressed: boolean;
  originalSize: number;
  compressedSize: number;
  ratio: number;
}

/**
 * Attempts to compress payload using Deflate/GZIP.
 * If compressed data is not smaller than original data, returns uncompressed payload.
 */
export function compressPayload(input: Uint8Array | string): CompressionResult {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const originalSize = bytes.length;

  if (originalSize <= 24) {
    // Very small payloads don't benefit from compression due to header overhead
    return {
      data: bytes,
      isCompressed: false,
      originalSize,
      compressedSize: originalSize,
      ratio: 1.0,
    };
  }

  try {
    const compressed = deflateSync(bytes, { level: 9 });
    if (compressed.length < originalSize) {
      return {
        data: compressed,
        isCompressed: true,
        originalSize,
        compressedSize: compressed.length,
        ratio: +(compressed.length / originalSize).toFixed(3),
      };
    }
  } catch (err) {
    console.warn('Deflate compression failed, falling back to raw:', err);
  }

  return {
    data: bytes,
    isCompressed: false,
    originalSize,
    compressedSize: originalSize,
    ratio: 1.0,
  };
}

/**
 * Decompresses Deflate or GZIP data, with graceful fallback to uncompressed bytes.
 */
export function decompressPayload(input: Uint8Array, isCompressed: boolean): Uint8Array {
  if (!isCompressed) {
    return input;
  }

  try {
    return inflateSync(input);
  } catch (deflateErr) {
    try {
      return gunzipSync(input);
    } catch (gzipErr) {
      console.warn('Decompression failed, returning raw bytes:', deflateErr, gzipErr);
      return input;
    }
  }
}
