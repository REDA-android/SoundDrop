/**
 * Real File System Access API & Directory Inspector
 * Strictly implements:
 * 1. Native `window.showDirectoryPicker()` recursive inspection
 * 2. Fallback `<input type="file" webkitdirectory multiple>` inspection
 * 3. Zero mock data: all metrics (file count, directory count, byte size, extension breakdown,
 *    SHA-256 hashes, and relative tree paths) are computed from the real local file system.
 * 4. On-the-fly real ZIP archive bundling via `fflate` for seamless P2P folder transfer.
 */

import { zipSync } from 'fflate';
import { computeSHA256 } from './crypto';

export interface ScannedFileEntry {
  name: string;
  relativePath: string;
  size: number;
  type: string;
  lastModified: number;
  extension: string;
  file: File;
}

export interface ExtensionStat {
  extension: string;
  count: number;
  totalBytes: number;
  percentage: number;
}

export interface RealDirectoryAnalysis {
  rootName: string;
  totalFiles: number;
  totalDirectories: number;
  totalBytes: number;
  maxDepth: number;
  entries: ScannedFileEntry[];
  extensionStats: ExtensionStat[];
  bundledZipFile: File;
  rootSha256: string;
  scannedAt: number;
  sourceMethod: 'showDirectoryPicker' | 'webkitdirectory';
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
}

/**
 * Checks whether the browser supports native `window.showDirectoryPicker()`.
 */
export function supportsShowDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function'
  );
}

function extractExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0 || idx === fileName.length - 1) return 'sans-ext';
  return fileName.substring(idx + 1).toLowerCase();
}

/**
 * Recursively traverses a real `FileSystemDirectoryHandle` obtained from `window.showDirectoryPicker()`.
 */
async function traverseDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  currentPath: string,
  entries: ScannedFileEntry[],
  dirSet: Set<string>,
  depth: number,
  maxFilesLimit = 2500
): Promise<number> {
  let maxDepthReached = depth;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asyncIterable = (dirHandle as any).values
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dirHandle as any).values()
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dirHandle as any).entries();

  for await (const item of asyncIterable) {
    if (entries.length >= maxFilesLimit) break;

    const handle: FileSystemHandle = Array.isArray(item) ? item[1] : item;
    if (!handle) continue;

    // Skip hidden heavy VCS/dependency folders if user selects a code repo
    if (
      handle.kind === 'directory' &&
      (handle.name === 'node_modules' || handle.name === '.git' || handle.name === '.next')
    ) {
      continue;
    }

    const relPath = currentPath ? `${currentPath}/${handle.name}` : handle.name;

    if (handle.kind === 'file') {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      entries.push({
        name: file.name,
        relativePath: relPath,
        size: file.size,
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
        extension: extractExtension(file.name),
        file,
      });
    } else if (handle.kind === 'directory') {
      dirSet.add(relPath);
      const subDirHandle = handle as FileSystemDirectoryHandle;
      const subDepth = await traverseDirectoryHandle(
        subDirHandle,
        relPath,
        entries,
        dirSet,
        depth + 1,
        maxFilesLimit
      );
      if (subDepth > maxDepthReached) {
        maxDepthReached = subDepth;
      }
    }
  }

  return maxDepthReached;
}

/**
 * Builds the complete `RealDirectoryAnalysis` and packages a real ZIP `File` using `fflate`.
 */
async function finalizeDirectoryAnalysis(
  rootName: string,
  entries: ScannedFileEntry[],
  totalDirectories: number,
  maxDepth: number,
  sourceMethod: 'showDirectoryPicker' | 'webkitdirectory',
  onProgress?: (status: string) => void
): Promise<RealDirectoryAnalysis> {
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  let totalBytes = 0;
  const extMap = new Map<string, { count: number; totalBytes: number }>();

  for (const entry of entries) {
    totalBytes += entry.size;
    const prev = extMap.get(entry.extension) || { count: 0, totalBytes: 0 };
    prev.count += 1;
    prev.totalBytes += entry.size;
    extMap.set(entry.extension, prev);
  }

  const extensionStats: ExtensionStat[] = Array.from(extMap.entries())
    .map(([extension, data]) => ({
      extension,
      count: data.count,
      totalBytes: data.totalBytes,
      percentage: totalBytes > 0 ? Math.round((data.totalBytes / totalBytes) * 100) : 0,
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes);

  if (onProgress) {
    onProgress(`Empaquetage ZIP réel de ${entries.length} fichiers (${rootName})...`);
  }

  // Build real ZIP archive using fflate so the folder can be streamed over WebRTC / OpenDrop / LocalSend
  const zipData: Record<string, Uint8Array> = {};
  const MAX_ZIP_BUNDLE_BYTES = 150 * 1024 * 1024; // 150 MB in-memory safety ceiling
  let accumulatedBytes = 0;

  for (const entry of entries) {
    if (accumulatedBytes + entry.size > MAX_ZIP_BUNDLE_BYTES) {
      break;
    }
    const buf = await entry.file.arrayBuffer();
    zipData[entry.relativePath] = new Uint8Array(buf);
    accumulatedBytes += entry.size;
  }

  const zippedBytes = zipSync(zipData, { level: 1 }); // Fast real ZIP compression
  const cleanRoot = rootName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'dossier';
  const bundledZipFile = new File(
    [zippedBytes as unknown as BlobPart],
    `${cleanRoot}.zip`,
    {
      type: 'application/zip',
      lastModified: Date.now(),
    }
  );

  if (onProgress) {
    onProgress('Calcul de l’empreinte SHA-256 réelle du dossier...');
  }
  const rootSha256 = await computeSHA256(bundledZipFile);

  return {
    rootName,
    totalFiles: entries.length,
    totalDirectories,
    totalBytes,
    maxDepth,
    entries,
    extensionStats,
    bundledZipFile,
    rootSha256,
    scannedAt: Date.now(),
    sourceMethod,
  };
}

/**
 * 1. Primary Method: Native `window.showDirectoryPicker()` inspection.
 */
export async function pickAndAnalyzeDirectoryReal(
  onProgress?: (status: string) => void
): Promise<RealDirectoryAnalysis> {
  const win = window as WindowWithDirectoryPicker;
  if (typeof win.showDirectoryPicker !== 'function') {
    throw new Error('API showDirectoryPicker non supportée sur ce navigateur');
  }

  const dirHandle = await win.showDirectoryPicker({ mode: 'read' });
  if (onProgress) {
    onProgress(`Lecture du dossier local "${dirHandle.name}"...`);
  }

  const entries: ScannedFileEntry[] = [];
  const dirSet = new Set<string>();
  const maxDepth = await traverseDirectoryHandle(dirHandle, '', entries, dirSet, 1);

  if (entries.length === 0) {
    throw new Error(`Le dossier "${dirHandle.name}" ne contient aucun fichier lisible.`);
  }

  return finalizeDirectoryAnalysis(
    dirHandle.name,
    entries,
    dirSet.size,
    maxDepth,
    'showDirectoryPicker',
    onProgress
  );
}

/**
 * 2. Fallback Method: `<input type="file" webkitdirectory multiple>` FileList analysis.
 */
export async function analyzeWebkitDirectoryFiles(
  fileList: FileList | File[],
  onProgress?: (status: string) => void
): Promise<RealDirectoryAnalysis> {
  const files = Array.from(fileList);
  if (files.length === 0) {
    throw new Error('Aucun fichier trouvé dans le dossier sélectionné.');
  }

  const entries: ScannedFileEntry[] = [];
  const dirSet = new Set<string>();
  let rootName = 'Dossier_Local';
  let maxDepth = 1;

  for (const file of files) {
    const rawRelPath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const segments = rawRelPath.split('/').filter(Boolean);

    if (segments.length > 1 && rootName === 'Dossier_Local') {
      rootName = segments[0];
    }

    // Ignore node_modules or .git inside fallback selection
    if (segments.includes('node_modules') || segments.includes('.git') || segments.includes('.next')) {
      continue;
    }

    const relativeInsideRoot =
      segments.length > 1 ? segments.slice(1).join('/') : segments[0] || file.name;

    if (segments.length > maxDepth) {
      maxDepth = segments.length;
    }

    if (segments.length > 2) {
      const parentDirs = segments.slice(1, -1);
      let partial = '';
      for (const d of parentDirs) {
        partial = partial ? `${partial}/${d}` : d;
        dirSet.add(partial);
      }
    }

    entries.push({
      name: file.name,
      relativePath: relativeInsideRoot,
      size: file.size,
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      extension: extractExtension(file.name),
      file,
    });
  }

  if (entries.length === 0) {
    throw new Error('Aucun fichier valide trouvé dans le dossier sélectionné.');
  }

  return finalizeDirectoryAnalysis(
    rootName,
    entries,
    dirSet.size,
    maxDepth,
    'webkitdirectory',
    onProgress
  );
}
