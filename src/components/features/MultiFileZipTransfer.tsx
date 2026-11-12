'use client';

import React, { useState, useCallback } from 'react';
import {
  Archive,
  File as FileIcon,
  FileArchive,
  Download,
  Trash2,
  Share2,
  Check,
  AlertCircle,
  FilePlus,
  Radio,
} from 'lucide-react';
import { zipSync, Zippable } from 'fflate';
import { DrawablySketchBadge } from '@/components/ui/DrawablySketchBadge';

interface MultiFileZipTransferProps {
  onZipReadyForTransfer?: (zipFile: File) => void;
}

export const MultiFileZipTransfer: React.FC<MultiFileZipTransferProps> = ({
  onZipReadyForTransfer,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [zipResult, setZipResult] = useState<{
    file: File;
    url: string;
    uncompressedSize: number;
    compressedSize: number;
    ratio: number;
  } | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFilesSelected = (newFiles: FileList | File[]) => {
    setError(null);
    const added = Array.from(newFiles);
    setFiles((prev) => [...prev, ...added]);
    setZipResult(null);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setZipResult(null);
  };

  const totalRawSize = files.reduce((acc, f) => acc + f.size, 0);

  // Compress all selected files into a ZIP archive in browser
  const createZipArchive = async () => {
    if (files.length === 0 || isZipping) return;

    try {
      setIsZipping(true);
      setError(null);

      const zippableObj: Zippable = {};

      for (const file of files) {
        const buffer = await file.arrayBuffer();
        zippableObj[file.name] = new Uint8Array(buffer);
      }

      // Perform synchronous in-memory compression with fflate
      const zippedU8 = zipSync(zippableObj, { level: 6 });

      const zipBlob = new Blob([zippedU8.buffer as ArrayBuffer], {
        type: 'application/zip',
      });
      const zipFileName = `sounddrop-bundle-${new Date().toISOString().slice(0, 10)}.zip`;
      const generatedFile = new File([zipBlob], zipFileName, { type: 'application/zip' });
      const objectUrl = URL.createObjectURL(zipBlob);

      const rawTotal = totalRawSize;
      const compTotal = zippedU8.byteLength;
      const ratio = rawTotal > 0 ? Math.round(((rawTotal - compTotal) / rawTotal) * 100) : 0;

      const result = {
        file: generatedFile,
        url: objectUrl,
        uncompressedSize: rawTotal,
        compressedSize: compTotal,
        ratio: Math.max(0, ratio),
      };

      setZipResult(result);

      if (onZipReadyForTransfer) {
        onZipReadyForTransfer(generatedFile);
      }
    } catch (err) {
      setError(`Erreur lors de la compression ZIP : ${(err as Error).message}`);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="w-full glass-panel rounded-2xl p-5 sm:p-6 flex flex-col gap-5 text-[#E4E4E7]">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-transparent border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/10">
            <Archive className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold font-mono tracking-tight text-white">
                Transfert Multi-Fichiers ZIP
              </h3>
              <DrawablySketchBadge text="CLIENT-SIDE" accent="orange" />
            </div>
            <p className="text-xs text-neutral-400">
              Compression ZIP en streaming directement dans le navigateur (0% serveur)
            </p>
          </div>
        </div>

        {files.length > 0 && (
          <div className="font-mono text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full">
            <span>{files.length} fichier(s) • {(totalRawSize / 1024).toFixed(1)} Ko</span>
          </div>
        )}
      </div>

      {/* Zone de glisser-déposer multi-fichiers */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) {
            handleFilesSelected(e.dataTransfer.files);
          }
        }}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.onchange = (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files?.length) handleFilesSelected(target.files);
          };
          input.click();
        }}
        className="border-2 border-dashed border-white/10 hover:border-amber-500/50 rounded-xl p-6 text-center flex flex-col items-center justify-center gap-3 bg-[#08090F]/60 hover:bg-amber-500/[0.02] transition-all cursor-pointer group"
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-transparent border border-amber-500/25 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
          <FilePlus className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs text-neutral-200 font-medium">
            Glissez plusieurs fichiers ici ou <span className="text-amber-400 underline underline-offset-4">parcourez vos dossiers</span>
          </p>
          <p className="text-[11px] text-neutral-500 mt-1">
            Photos, documents, code source, dossiers entiers
          </p>
        </div>
      </div>

      {/* Liste des fichiers sélectionnés */}
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-mono text-neutral-400 border-b border-white/[0.06] pb-2">
            <span>Fichiers à compresser ({files.length})</span>
            <button
              type="button"
              onClick={() => {
                setFiles([]);
                setZipResult(null);
              }}
              className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Tout retirer</span>
            </button>
          </div>

          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
            {files.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center justify-between p-2.5 bg-[#08090F] border border-white/[0.06] rounded-xl text-xs font-mono"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <FileIcon className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-white truncate">{file.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-neutral-500 text-[11px]">
                    {(file.size / 1024).toFixed(1)} Ko
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(idx);
                    }}
                    className="text-neutral-500 hover:text-red-400 p-1"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Bouton de compression */}
          {!zipResult && (
            <button
              type="button"
              onClick={() => void createZipArchive()}
              disabled={isZipping}
              className="mt-2 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black disabled:opacity-40 transition-all shadow-[0_0_20px_rgba(245,158,11,0.25)] active:scale-[0.99]"
            >
              <FileArchive className="w-4 h-4" />
              <span>{isZipping ? 'Compression en cours...' : 'Générer l’archive ZIP locale'}</span>
            </button>
          )}
        </div>
      )}

      {/* Résultat de la compression */}
      {zipResult && (
        <div className="relative overflow-hidden bg-gradient-to-b from-[#141812] to-[#0A0D08] border border-emerald-500/30 rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5 shadow-xl shadow-emerald-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
              <Check className="w-4 h-4" />
              <span>Archive ZIP Prête</span>
            </div>
            <span className="text-[11px] font-mono text-emerald-300">
              Gain : -{zipResult.ratio}% d'espace
            </span>
          </div>

          <div className="flex items-center justify-between p-3 bg-black/40 border border-white/[0.06] rounded-xl text-xs font-mono">
            <div>
              <p className="text-white font-bold">{zipResult.file.name}</p>
              <p className="text-neutral-400 text-[11px]">
                {(zipResult.compressedSize / 1024).toFixed(1)} Ko (initialement {(zipResult.uncompressedSize / 1024).toFixed(1)} Ko)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href={zipResult.url}
              download={zipResult.file.name}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-mono text-xs font-bold bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-black border border-emerald-400/30 transition-all shadow-md shadow-emerald-500/20 active:scale-[0.99]"
            >
              <Download className="w-4 h-4" />
              <span>Télécharger le ZIP</span>
            </a>

            {onZipReadyForTransfer && (
              <button
                type="button"
                onClick={() => onZipReadyForTransfer(zipResult.file)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-mono text-xs font-bold bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/10 transition-all"
              >
                <Radio className="w-4 h-4 text-amber-400" />
                <span>Envoyer via SoundDrop</span>
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
