/**
 * Incremental & Zero-RAM SHA-256 Engine powered by `hash-wasm` (WebAssembly SIMD)
 * with graceful fallback to Web Crypto API (`crypto.subtle.digest`).
 * Prevents Out-Of-Memory (OOM) crashes on multi-gigabyte files.
 */

import { createSHA256, IHasher } from 'hash-wasm';

const HASH_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB slices for zero RAM bloat

export class IncrementalSHA256 {
  private hasher: IHasher | null = null;

  public async init(): Promise<void> {
    this.hasher = await createSHA256();
    this.hasher.init();
  }

  public update(chunk: Uint8Array): void {
    if (!this.hasher) {
      throw new Error('IncrementalSHA256 hasher not initialized');
    }
    this.hasher.update(chunk);
  }

  public digestHex(): string {
    if (!this.hasher) {
      throw new Error('IncrementalSHA256 hasher not initialized');
    }
    return this.hasher.digest('hex');
  }
}

/**
 * Computes SHA-256 of an arbitrarily large File or Blob by reading 2 MB slices
 * incrementally through `hash-wasm` without loading the entire file into RAM.
 */
export async function computeSHA256(
  data: File | Blob | ArrayBuffer | Uint8Array,
  onProgress?: (hashedBytes: number, totalBytes: number) => void
): Promise<string> {
  try {
    const hasher = await createSHA256();
    hasher.init();

    if (data instanceof Blob) {
      let offset = 0;
      const total = data.size;
      while (offset < total) {
        const slice = data.slice(offset, offset + HASH_CHUNK_SIZE);
        const buf = await slice.arrayBuffer();
        hasher.update(new Uint8Array(buf));
        offset += buf.byteLength;
        if (onProgress) {
          onProgress(offset, total);
        }
      }
      return hasher.digest('hex');
    } else if (data instanceof Uint8Array) {
      hasher.update(data);
      return hasher.digest('hex');
    } else {
      hasher.update(new Uint8Array(data));
      return hasher.digest('hex');
    }
  } catch {
    // Fallback to native Web Crypto API for small buffers if WASM initialization fails
    let buffer: ArrayBuffer;
    if (data instanceof Blob) {
      buffer = await data.arrayBuffer();
    } else if (data instanceof Uint8Array) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    } else {
      buffer = data;
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export async function verifySHA256(
  data: File | Blob | ArrayBuffer | Uint8Array,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await computeSHA256(data);
  return actualHash.toLowerCase() === expectedHash.toLowerCase();
}
