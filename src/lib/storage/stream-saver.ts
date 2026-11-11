/**
 * Anti-Crash Multi-Gigabyte Storage Engine
 * Integrates:
 * 1. In-Memory Guaranteed Chunk Buffer for files <= 150 MB (100% immune to mobile OPFS stream lock bugs)
 * 2. Origin Private File System (OPFS) for multi-hundred-MB / GB files on desktop browsers
 * 3. Native File System Access API (`showSaveFilePicker`), Web Share API (`navigator.share` for iOS/Android),
 *    and synchronous `<a download>` fallback
 * 4. `hash-wasm` incremental SHA-256 verification on the fly
 */

import { IncrementalSHA256 } from './crypto';

export interface SavedFileResult {
  blob: Blob;
  url: string;
  name: string;
  size: number;
  mimeType?: string;
  usingOpfs: boolean;
  storageEngine: 'OPFS' | 'StreamSaver.js' | 'browser-fs-access' | 'MemoryBlob';
  computedSha256: string;
}

const OPFS_MIN_SIZE_BYTES = 150 * 1024 * 1024; // Use OPFS only for files > 150 MB

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export class StreamSaverSession {
  private fileName: string;
  private mimeType: string;
  private expectedSize: number;
  private opfsFileHandle: FileSystemFileHandle | null = null;
  private opfsWritable: FileSystemWritableFileStream | null = null;
  private streamSaverWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private memoryChunks: Uint8Array[] = [];
  private receivedBytes = 0;
  private isFinalized = false;
  private useOpfs = false;
  private useStreamSaver = false;
  private incrementalHasher: IncrementalSHA256;
  private initPromise: Promise<void> | null = null;

  constructor(fileName: string, mimeType: string, expectedSize: number = 0) {
    this.fileName = fileName;
    this.mimeType = mimeType || 'application/octet-stream';
    this.expectedSize = expectedSize;
    this.incrementalHasher = new IncrementalSHA256();
  }

  public initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    await this.incrementalHasher.init();

    // For files <= 150 MB (photos, documents, audio, archives), always use deterministic
    // in-memory chunks so mobile browsers (iOS Safari / Android Chrome) never lose bytes
    // when closing OPFS WritableStreams.
    if (this.expectedSize <= OPFS_MIN_SIZE_BYTES) {
      this.useOpfs = false;
      this.useStreamSaver = false;
      return;
    }

    // 1. Primary for large files (> 150 MB): Origin Private File System (OPFS)
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.storage &&
        typeof navigator.storage.getDirectory === 'function'
      ) {
        const root = await navigator.storage.getDirectory();
        const safeName = `transfer_${Date.now()}_${this.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const handle = await root.getFileHandle(safeName, { create: true });
        if (typeof handle.createWritable === 'function') {
          this.opfsFileHandle = handle;
          this.opfsWritable = await handle.createWritable();
          this.useOpfs = true;
          return;
        }
      }
    } catch (e) {
      console.warn('OPFS unavailable, falling back to memory/StreamSaver:', e);
    }

    // 2. Secondary for huge files (> 250 MB) when OPFS is unavailable
    if (this.expectedSize > 250 * 1024 * 1024 && typeof window !== 'undefined') {
      try {
        const streamSaverModule = await import('streamsaver');
        const streamSaver = streamSaverModule.default || streamSaverModule;
        const fileStream = streamSaver.createWriteStream(this.fileName, {
          size: this.expectedSize,
        });
        this.streamSaverWriter = fileStream.getWriter();
        this.useStreamSaver = true;
        return;
      } catch (e) {
        console.warn('StreamSaver initialization skipped, using memory chunks:', e);
      }
    }

    this.useOpfs = false;
    this.useStreamSaver = false;
  }

  public async writeChunk(chunk: Uint8Array): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
    if (this.isFinalized) {
      return;
    }

    // Always copy the chunk buffer so detached/reused WebRTC buffers never mutate stored data
    const chunkCopy = new Uint8Array(chunk.byteLength);
    chunkCopy.set(chunk);

    this.receivedBytes += chunkCopy.byteLength;
    this.incrementalHasher.update(chunkCopy);

    // Always keep in-memory copy for files <= 150 MB as a 100% guaranteed source of truth
    if (!this.useOpfs || this.expectedSize <= OPFS_MIN_SIZE_BYTES) {
      this.memoryChunks.push(chunkCopy);
    }

    if (this.useOpfs && this.opfsWritable) {
      try {
        await this.opfsWritable.write(chunkCopy as unknown as BufferSource);
        return;
      } catch (err) {
        console.warn('OPFS write failed, using memory chunks fallback:', err);
        this.useOpfs = false;
        if (this.memoryChunks.length === 0) {
          this.memoryChunks.push(chunkCopy);
        }
      }
    }

    if (this.useStreamSaver && this.streamSaverWriter) {
      try {
        await this.streamSaverWriter.write(chunkCopy);
        return;
      } catch (err) {
        console.warn('StreamSaver write failed, switching to memory fallback:', err);
        this.useStreamSaver = false;
      }
    }
  }

  public async finalize(): Promise<SavedFileResult> {
    if (this.initPromise) {
      await this.initPromise;
    }
    this.isFinalized = true;
    const computedSha256 = this.incrementalHasher.digestHex();

    if (this.useOpfs && this.opfsWritable && this.opfsFileHandle) {
      try {
        await this.opfsWritable.close();
        this.opfsWritable = null;
        const file = await this.opfsFileHandle.getFile();
        if (file.size > 0 && file.size >= this.receivedBytes) {
          const url = URL.createObjectURL(file);
          this.memoryChunks = [];
          return {
            blob: file,
            url,
            name: this.fileName,
            size: file.size,
            mimeType: this.mimeType,
            usingOpfs: true,
            storageEngine: 'OPFS',
            computedSha256,
          };
        }
      } catch (err) {
        console.warn('OPFS finalize error, falling back to memory chunks:', err);
      }
    }

    if (this.useStreamSaver && this.streamSaverWriter) {
      try {
        await this.streamSaverWriter.close();
        this.streamSaverWriter = null;
        const emptyBlob = new Blob([], { type: this.mimeType });
        return {
          blob: emptyBlob,
          url: '#',
          name: this.fileName,
          size: this.receivedBytes,
          mimeType: this.mimeType,
          usingOpfs: false,
          storageEngine: 'StreamSaver.js',
          computedSha256,
        };
      } catch (err) {
        console.warn('StreamSaver close error:', err);
      }
    }

    const blob = new Blob(this.memoryChunks as unknown as BlobPart[], { type: this.mimeType });
    const url = URL.createObjectURL(blob);
    this.memoryChunks = [];

    return {
      blob,
      url,
      name: this.fileName,
      size: blob.size,
      mimeType: this.mimeType,
      usingOpfs: false,
      storageEngine: 'MemoryBlob',
      computedSha256,
    };
  }

  public async abort(): Promise<void> {
    this.isFinalized = true;
    this.memoryChunks = [];
    if (this.opfsWritable) {
      try {
        await this.opfsWritable.abort();
      } catch {
        // Ignored
      }
      this.opfsWritable = null;
    }
    if (this.streamSaverWriter) {
      try {
        await this.streamSaverWriter.abort();
      } catch {
        // Ignored
      }
      this.streamSaverWriter = null;
    }
  }

  public getBytesWritten(): number {
    return this.receivedBytes;
  }
}

/**
 * Triggers a direct synchronous anchor download (`<a download>`) preserving transient user activation.
 */
function triggerAnchorDownload(result: SavedFileResult): void {
  const downloadUrl =
    result.url && result.url !== '#' ? result.url : URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = result.name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (document.body.contains(a)) {
      document.body.removeChild(a);
    }
  }, 1500);
}

/**
 * Saves a received file to disk:
 * 1. On Desktop Chrome/Edge: uses native `window.showSaveFilePicker`
 * 2. On iOS / Android Mobile: uses native Web Share File sheet (`navigator.share({ files })`) or synchronous `<a download>`
 */
export async function saveWithBrowserFsAccess(result: SavedFileResult): Promise<void> {
  if (!result.blob || result.blob.size === 0) {
    console.warn('Empty blob warning during save:', result.name);
  }

  const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;

  // 1. Desktop Native File System Access API (`showSaveFilePicker`)
  if (win && typeof win.showSaveFilePicker === 'function') {
    try {
      const showSaveFilePicker = win.showSaveFilePicker as (
        options?: Record<string, unknown>
      ) => Promise<FileSystemFileHandle>;
      const handle = await showSaveFilePicker({
        suggestedName: result.name,
      });
      const writable = await handle.createWritable();
      await writable.write(result.blob);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }

  // 2. Mobile iOS / Android Native Share Sheet (allows saving directly to Photos or Files on iPhone)
  const isMobile =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  if (isMobile && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const fileObj = new File([result.blob], result.name, {
        type: result.mimeType || result.blob.type || 'application/octet-stream',
      });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [fileObj] })) {
        await navigator.share({
          files: [fileObj],
          title: result.name,
        });
        return;
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }

  // 3. Universal synchronous `<a download>` fallback
  triggerAnchorDownload(result);
}

/**
 * Triggers direct download or StreamSaver stream for an existing Blob/File.
 */
export async function saveWithStreamSaver(result: SavedFileResult): Promise<void> {
  // For files already in memory <= 200 MB, direct anchor download is instant and works offline
  if (result.blob && result.blob.size > 0 && result.blob.size <= 200 * 1024 * 1024) {
    triggerAnchorDownload(result);
    return;
  }

  try {
    const streamSaverModule = await import('streamsaver');
    const streamSaver = streamSaverModule.default || streamSaverModule;
    const fileStream = streamSaver.createWriteStream(result.name, {
      size: result.size,
    });
    const readableStream = result.blob.stream();
    if (window.WritableStream && readableStream.pipeTo) {
      await readableStream.pipeTo(fileStream);
    } else {
      const writer = fileStream.getWriter();
      const reader = readableStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          await writer.close();
          break;
        }
        await writer.write(value);
      }
    }
  } catch {
    triggerAnchorDownload(result);
  }
}
