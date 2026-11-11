'use client';

import React, { useRef, useState } from 'react';
import {
  File as FileIcon,
  FolderOpen,
  X,
  UploadCloud,
  Layers,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { formatBytes } from '@/lib/utils/formatters';
import {
  RealDirectoryAnalysis,
  pickAndAnalyzeDirectoryReal,
  analyzeWebkitDirectoryFiles,
  supportsShowDirectoryPicker,
} from '@/lib/storage/directory-scanner';

interface DropzoneProps {
  onFileSelected: (file: File, dirAnalysis?: RealDirectoryAnalysis | null) => void;
  selectedFile?: File | null;
  directoryAnalysis?: RealDirectoryAnalysis | null;
  onClearFile?: () => void;
  disabled?: boolean;
}

export const FileDropzone: React.FC<DropzoneProps> = ({
  onFileSelected,
  selectedFile,
  directoryAnalysis,
  onClearFile,
  disabled = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isScanningDir, setIsScanningDir] = useState(false);
  const [scanStatusText, setScanStatusText] = useState<string>('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [showTreePreview, setShowTreePreview] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || isScanningDir) return;
    setScanError(null);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 1) {
      try {
        setIsScanningDir(true);
        setScanStatusText('Analyse réelle des fichiers déposés...');
        const analysis = await analyzeWebkitDirectoryFiles(
          e.dataTransfer.files,
          setScanStatusText
        );
        onFileSelected(analysis.bundledZipFile, analysis);
      } catch (err) {
        setScanError((err as Error).message);
      } finally {
        setIsScanningDir(false);
        setScanStatusText('');
      }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length === 1) {
      await handleRawSingleFilePicked(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Snapshot files <= 100 MB into an in-memory File immediately on selection so iOS Safari
  // temporary Photo Library handles never expire when the input unmounts.
  const handleRawSingleFilePicked = async (rawFile: File) => {
    try {
      if (rawFile.size <= 100 * 1024 * 1024) {
        const buf = await rawFile.arrayBuffer();
        const memorySafeFile = new File([buf], rawFile.name, {
          type: rawFile.type || 'application/octet-stream',
          lastModified: rawFile.lastModified,
        });
        onFileSelected(memorySafeFile, null);
        return;
      }
    } catch {
      // Fallback to rawFile
    }
    onFileSelected(rawFile, null);
  };

  // 1. Select a Single Local File synchronously in 0ms (no async import lag)
  const handleSelectSingleFile = () => {
    if (disabled || isScanningDir) return;
    setScanError(null);
    fileInputRef.current?.click();
  };

  // 2. Select a Local Directory via Real `window.showDirectoryPicker()` with mandatory `<input webkitdirectory>` fallback
  const handleSelectLocalDirectory = async () => {
    if (disabled || isScanningDir) return;
    setScanError(null);

    if (supportsShowDirectoryPicker()) {
      try {
        setIsScanningDir(true);
        setScanStatusText('Ouverture du sélecteur de dossier (showDirectoryPicker)...');
        const analysis = await pickAndAnalyzeDirectoryReal((msg) => setScanStatusText(msg));
        onFileSelected(analysis.bundledZipFile, analysis);
        return;
      } catch (err) {
        const errorName = (err as Error).name;
        if (errorName === 'AbortError') {
          setIsScanningDir(false);
          setScanStatusText('');
          return;
        }
        // Fallback to <input type="file" webkitdirectory> if showDirectoryPicker fails or is restricted
        setIsScanningDir(false);
        setScanStatusText('');
        dirInputRef.current?.click();
        return;
      } finally {
        setIsScanningDir(false);
        setScanStatusText('');
      }
    } else {
      // Mandatory fallback for browsers/contexts without window.showDirectoryPicker()
      dirInputRef.current?.click();
    }
  };

  const handleWebkitDirectoryChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setScanError(null);

    try {
      setIsScanningDir(true);
      setScanStatusText('Inspection réelle de l’arborescence locale (webkitdirectory)...');
      const analysis = await analyzeWebkitDirectoryFiles(files, (msg) => setScanStatusText(msg));
      onFileSelected(analysis.bundledZipFile, analysis);
    } catch (err) {
      setScanError((err as Error).message);
    } finally {
      setIsScanningDir(false);
      setScanStatusText('');
      e.target.value = '';
    }
  };

  // Active Selected State (Real File or Real Directory Bundle)
  if (selectedFile) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-[#16161D] border border-white/15 p-4 shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5 overflow-hidden">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5500]/15 border border-[#FF5500]/40 text-[#FF6A1F]">
              {directoryAnalysis ? (
                <FolderOpen aria-hidden="true" className="h-5 w-5" />
              ) : (
                <FileIcon aria-hidden="true" className="h-5 w-5" />
              )}
            </div>
            <div className="overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-[#F4F4F6]">
                  {directoryAnalysis ? directoryAnalysis.rootName : selectedFile.name}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-[#10B981]/15 border border-[#10B981]/30 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#34D399]">
                  <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
                  {directoryAnalysis ? 'DOSSIER RÉEL' : 'FICHIER RÉEL'}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-[#A1A1AA]">
                {directoryAnalysis ? (
                  <>
                    {directoryAnalysis.totalFiles} fichiers • {directoryAnalysis.totalDirectories}{' '}
                    sous-dossiers • {formatBytes(directoryAnalysis.totalBytes)} (ZIP:{' '}
                    {formatBytes(selectedFile.size)})
                  </>
                ) : (
                  <>
                    {formatBytes(selectedFile.size)} •{' '}
                    {selectedFile.type || 'application/octet-stream'} • Modifié le{' '}
                    {new Date(selectedFile.lastModified).toLocaleDateString('fr-FR')}
                  </>
                )}
              </div>
            </div>
          </div>

          {!disabled && onClearFile && (
            <button
              type="button"
              onClick={onClearFile}
              aria-label="Retirer la source sélectionnée"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/10 text-[#D4D4D8] hover:bg-[#EF4444]/20 hover:border-[#EF4444]/40 hover:text-white transition-colors"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Real Directory Analytics & Tree Inspector (Zero Mock Data) */}
        {directoryAnalysis && (
          <div className="border-t border-white/10 pt-3 space-y-2.5 font-mono text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl bg-[#0C0C10] border border-white/10 p-2.5">
                <span className="block text-[10px] uppercase text-[#A1A1AA]">Fichiers Réels</span>
                <span className="mt-0.5 block text-sm font-bold text-[#F4F4F6]">
                  {directoryAnalysis.totalFiles}
                </span>
              </div>
              <div className="rounded-xl bg-[#0C0C10] border border-white/10 p-2.5">
                <span className="block text-[10px] uppercase text-[#A1A1AA]">Taille Brute</span>
                <span className="mt-0.5 block text-sm font-bold text-[#F4F4F6]">
                  {formatBytes(directoryAnalysis.totalBytes)}
                </span>
              </div>
              <div className="rounded-xl bg-[#0C0C10] border border-white/10 p-2.5">
                <span className="block text-[10px] uppercase text-[#A1A1AA]">Profondeur</span>
                <span className="mt-0.5 block text-sm font-bold text-[#F4F4F6]">
                  {directoryAnalysis.maxDepth} niv.
                </span>
              </div>
              <div className="rounded-xl bg-[#0C0C10] border border-white/10 p-2.5">
                <span className="block text-[10px] uppercase text-[#A1A1AA]">API Source</span>
                <span className="mt-0.5 block text-xs font-bold text-[#FF7A33] truncate">
                  {directoryAnalysis.sourceMethod}
                </span>
              </div>
            </div>

            {/* Real Extension Distribution */}
            {directoryAnalysis.extensionStats.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-[#A1A1AA] mr-1">Extensions :</span>
                {directoryAnalysis.extensionStats.slice(0, 6).map((ext) => (
                  <span
                    key={ext.extension}
                    className="rounded-lg bg-[#0C0C10] border border-white/10 px-2 py-0.5 text-[11px] text-[#E4E4E7]"
                  >
                    .{ext.extension} ({ext.count} • {ext.percentage}%)
                  </span>
                ))}
              </div>
            )}

            {/* SHA-256 Digest & Expandable File Tree */}
            <div className="flex items-center justify-between gap-2 text-[11px] text-[#A1A1AA]">
              <span className="truncate">
                SHA-256 ZIP :{' '}
                <code className="text-[#E4E4E7]">
                  {directoryAnalysis.rootSha256.slice(0, 20)}…
                </code>
              </span>
              <button
                type="button"
                onClick={() => setShowTreePreview(!showTreePreview)}
                aria-expanded={showTreePreview}
                className="inline-flex items-center gap-1 text-[#FF7A33] hover:underline font-semibold flex-shrink-0"
              >
                <Layers aria-hidden="true" className="h-3.5 w-3.5" />
                <span>
                  {showTreePreview
                    ? 'Masquer l’arborescence'
                    : `Voir l’arborescence (${directoryAnalysis.entries.length})`}
                </span>
                {showTreePreview ? (
                  <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {showTreePreview && (
              <div className="max-h-40 overflow-y-auto rounded-xl bg-[#0A0A0D] border border-white/10 p-2.5 space-y-1">
                {directoryAnalysis.entries.slice(0, 100).map((entry) => (
                  <div
                    key={entry.relativePath}
                    className="flex items-center justify-between gap-2 text-[11px] py-0.5 border-b border-white/[0.04] last:border-none"
                  >
                    <span className="truncate text-[#E4E4E7]">{entry.relativePath}</span>
                    <span className="text-[#A1A1AA] flex-shrink-0">{formatBytes(entry.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // MANDATORY INITIAL EMPTY STATE (Zero Mock Data — Waiting for real file or folder selection)
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
      className={`rounded-2xl border-2 border-dashed p-5 transition-all duration-150 ${
        isDragging
          ? 'border-[#FF5500] bg-[#FF5500]/10'
          : 'border-white/15 bg-[#121217] hover:border-white/25'
      } ${disabled ? 'pointer-events-none opacity-40' : ''}`}
    >
      {/* Hidden Fallback Inputs: Single File & Mandatory webkitdirectory */}
      <input
        ref={fileInputRef}
        id="real-single-file-input"
        type="file"
        aria-label="Sélectionner un fichier local"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) {
            void handleRawSingleFilePicked(picked);
          }
        }}
      />

      <input
        ref={dirInputRef}
        id="real-webkitdirectory-input"
        type="file"
        aria-label="Sélectionner un dossier local"
        className="hidden"
        disabled={disabled}
        multiple
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(e) => void handleWebkitDirectoryChange(e)}
      />

      <div className="flex flex-col items-center text-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1C1C24] border border-white/15 text-[#FF6A1F]">
          {isScanningDir ? (
            <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin" />
          ) : (
            <UploadCloud aria-hidden="true" className="h-6 w-6" />
          )}
        </div>

        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[#F4F4F6]">
            {isScanningDir
              ? scanStatusText || 'Analyse du système de fichiers en cours...'
              : 'État Initial Vide — Sélectionnez une source locale réelle'}
          </h3>
          <p className="font-mono text-xs text-[#A1A1AA] max-w-md">
            Glissez-déposez un fichier ou inspectez un dossier local via{' '}
            <code className="text-[#E4E4E7]">showDirectoryPicker()</code> (avec fallback{' '}
            <code className="text-[#E4E4E7]">webkitdirectory</code>).
          </p>
        </div>

        {scanError && (
          <p role="alert" className="text-xs font-mono text-[#FCA5A5] bg-[#EF4444]/15 border border-[#EF4444]/30 rounded-lg px-3 py-1.5">
            {scanError}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full pt-1">
          <button
            type="button"
            disabled={disabled || isScanningDir}
            onClick={() => void handleSelectSingleFile()}
            className="tactile-btn-surface min-h-[42px] rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-center gap-2"
          >
            <FileIcon aria-hidden="true" className="h-4 w-4 text-[#FF6A1F]" />
            <span>Sélectionner un fichier</span>
          </button>

          <button
            type="button"
            disabled={disabled || isScanningDir}
            onClick={() => void handleSelectLocalDirectory()}
            className="tactile-btn-surface min-h-[42px] rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-center gap-2"
          >
            <FolderOpen aria-hidden="true" className="h-4 w-4 text-[#10B981]" />
            <span>Inspecter un dossier local</span>
          </button>
        </div>
      </div>
    </div>
  );
};
