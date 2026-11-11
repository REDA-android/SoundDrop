'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  UploadCloud,
  File,
  FileText,
  Folder,
  Send,
  Radio,
  Sparkles,
  Zap,
  Volume2,
  CheckCircle,
  X,
} from 'lucide-react';
import { DemodState } from '@/types/acoustic';

interface SonarDropZoneProps {
  demodState: DemodState;
  isTransmitting: boolean;
  isListening: boolean;
  onSendText: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendFolderFiles?: (files: File[]) => void;
  estimatedPackets?: number;
  estimatedDurationSec?: number;
  currentPayloadBytes?: number;
}

export const SonarDropZone: React.FC<SonarDropZoneProps> = ({
  demodState,
  isTransmitting,
  isListening,
  onSendText,
  onSendFile,
  onSendFolderFiles,
  estimatedPackets = 0,
  estimatedDurationSec = 0,
  currentPayloadBytes = 0,
}) => {
  const [activeTab, setActiveTab] = useState<'text' | 'file' | 'folder'>('text');
  const [textInput, setTextInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFolderFiles, setSelectedFolderFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Status text & colors for Sonar Radar
  const getRadarStatus = () => {
    if (isTransmitting) {
      return {
        label: 'BROADCASTING AUDIO',
        sub: 'Transmitting acoustic packet stream',
        color: 'border-cyan-400 text-cyan-300 shadow-[0_0_30px_rgba(6,182,212,0.5)]',
        ripple: 'animate-ping border-cyan-500/40',
      };
    }
    switch (demodState) {
      case 'LOCKED_ON_SIGNAL':
        return {
          label: 'LOCKED ON SIGNAL',
          sub: 'Preamble detected, synchronizing clock',
          color: 'border-amber-400 text-amber-300 shadow-[0_0_30px_rgba(245,158,11,0.5)]',
          ripple: 'animate-pulse border-amber-500/40',
        };
      case 'DECODING_SYMBOLS':
        return {
          label: 'RECEIVING PACKETS',
          sub: 'Decoding 16-FSK audio frames',
          color: 'border-emerald-400 text-emerald-300 shadow-[0_0_30px_rgba(16,185,129,0.5)]',
          ripple: 'animate-spin border-emerald-500/40',
        };
      case 'LISTENING_FOR_CHIRP':
        return {
          label: 'LISTENING FOR SOUND DROP',
          sub: 'Microphone active, scanning for chirp',
          color: 'border-cyan-500/50 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.2)]',
          ripple: 'animate-pulse border-cyan-500/20',
        };
      case 'IDLE':
      default:
        return {
          label: 'ACOUSTIC MODEM STANDBY',
          sub: 'Start listening or transmit a drop',
          color: 'border-slate-700 text-slate-400',
          ripple: '',
        };
    }
  };

  const radar = getRadarStatus();

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setActiveTab('file');
    }
  };

  // Standard Native File System Access API with input fallback
  const handlePickDirectory = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as unknown as {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker();

        const collectedFiles: File[] = [];
        for await (const entry of (dirHandle as unknown as AsyncIterable<FileSystemHandle>)) {
          if (entry.kind === 'file') {
            const fileHandle = entry as unknown as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            collectedFiles.push(file);
          }
        }
        if (collectedFiles.length > 0) {
          setSelectedFolderFiles(collectedFiles);
          setActiveTab('folder');
          onSendFolderFiles?.(collectedFiles);
        }
      } catch (err) {
        // User cancelled or browser rejected, fallback to input
        if ((err as Error).name !== 'AbortError') {
          folderInputRef.current?.click();
        }
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setSelectedFolderFiles(files);
      setActiveTab('folder');
      onSendFolderFiles?.(files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleTransmit = () => {
    if (activeTab === 'text' && textInput.trim()) {
      onSendText(textInput.trim());
    } else if (activeTab === 'file' && selectedFile) {
      onSendFile(selectedFile);
    } else if (activeTab === 'folder' && selectedFolderFiles.length > 0) {
      onSendFile(selectedFolderFiles[0]);
    }
  };

  return (
    <div className="flex flex-col gap-6 bg-surface p-6 rounded-2xl border border-surface-border backdrop-blur-md shadow-2xl">
      {/* Top Header & Sonar Radar Section */}
      <div className="flex flex-col md:flex-row items-center gap-6 justify-between">
        {/* AirDrop Sonar Radar Visualizer */}
        <div className="relative flex items-center justify-center w-36 h-36">
          {/* Concentric Radar Rings */}
          <div
            className={`absolute inset-0 rounded-full border border-dashed border-slate-700/60 ${radar.ripple}`}
          />
          <div
            className={`absolute inset-3 rounded-full border border-slate-700/80 ${
              isListening ? 'animate-ping duration-1000 border-cyan-500/20' : ''
            }`}
          />
          <div
            className={`absolute inset-7 rounded-full border ${radar.color} transition-all duration-300`}
          />

          {/* Central Sonar Orb */}
          <div
            className={`relative z-10 flex flex-col items-center justify-center w-16 h-16 rounded-full bg-slate-900 border-2 ${radar.color} transition-all duration-300`}
          >
            {isTransmitting ? (
              <Volume2 className="w-7 h-7 animate-bounce text-cyan-400" />
            ) : demodState === 'DECODING_SYMBOLS' ? (
              <Zap className="w-7 h-7 text-emerald-400 animate-pulse" />
            ) : (
              <Radio className="w-7 h-7 text-cyan-400" />
            )}
          </div>
        </div>

        {/* State Label & Payload Estimator */}
        <div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                isTransmitting
                  ? 'bg-cyan-400 animate-ping'
                  : demodState === 'DECODING_SYMBOLS'
                  ? 'bg-emerald-400 animate-pulse'
                  : isListening
                  ? 'bg-cyan-400'
                  : 'bg-slate-600'
              }`}
            />
            <h3 className="text-base font-semibold tracking-wider uppercase text-slate-200">
              {radar.label}
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-3">{radar.sub}</p>

          {/* Live Payload Estimator Card */}
          <div className="w-full bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 flex flex-wrap items-center justify-between text-xs font-mono text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Payload:</span>
              <span className="text-cyan-400 font-semibold">{currentPayloadBytes} B</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Acoustic Packets:</span>
              <span className="text-amber-400 font-semibold">{estimatedPackets}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Est. Time:</span>
              <span className="text-emerald-400 font-semibold">
                {estimatedDurationSec.toFixed(1)}s
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs: Text Note / Single File / Local Folder Inspection */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('text')}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'text'
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Text / Note
        </button>

        <button
          onClick={() => setActiveTab('file')}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'file'
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <File className="w-3.5 h-3.5" />
          Single File
        </button>

        <button
          onClick={() => setActiveTab('folder')}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'folder'
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <Folder className="w-3.5 h-3.5" />
          Folder Inspection
        </button>
      </div>

      {/* Input Tab Contents */}
      {activeTab === 'text' && (
        <div className="flex flex-col gap-2">
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type text, code, URLs, or notes to beam via acoustic audio waves..."
            rows={3}
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 font-mono resize-none transition-colors"
          />
        </div>
      )}

      {activeTab === 'file' && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors ${
            isDragOver
              ? 'border-cyan-400 bg-cyan-950/20'
              : selectedFile
              ? 'border-emerald-600/70 bg-emerald-950/10'
              : 'border-slate-800 hover:border-slate-700 bg-slate-950/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {selectedFile ? (
            <div className="flex flex-col items-center gap-1.5">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
              <span className="text-sm font-medium text-slate-100">{selectedFile.name}</span>
              <span className="text-xs text-slate-400 font-mono">
                {(selectedFile.size / 1024).toFixed(1)} KB ({selectedFile.type || 'binary'})
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFile(null);
                }}
                className="mt-2 text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Remove File
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <UploadCloud className="w-8 h-8 text-cyan-400/80 mb-1" />
              <p className="text-xs text-slate-300 font-medium">
                Click or drag & drop a file to transmit
              </p>
              <p className="text-[11px] text-slate-500">
                Images, documents, or small binaries (&lt; 100 KB recommended for acoustic)
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'folder' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Real File System Access API with directory inspection:
            </span>
            <button
              onClick={handlePickDirectory}
              className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center gap-1.5 font-medium transition-colors"
            >
              <Folder className="w-3.5 h-3.5 text-amber-400" />
              Select Local Folder
            </button>
            {/* Fallback input for browsers without showDirectoryPicker */}
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory standard fallback
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolderInputChange}
              className="hidden"
            />
          </div>

          {selectedFolderFiles.length > 0 ? (
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 max-h-40 overflow-y-auto flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-1 border-b border-slate-800">
                <span>{selectedFolderFiles.length} file(s) found in local folder:</span>
                <span className="font-mono text-cyan-400">
                  Total:{' '}
                  {(
                    selectedFolderFiles.reduce((acc, f) => acc + f.size, 0) / 1024
                  ).toFixed(1)}{' '}
                  KB
                </span>
              </div>
              {selectedFolderFiles.slice(0, 5).map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-slate-300 py-0.5">
                  <span className="truncate max-w-[200px]">{f.name}</span>
                  <span className="text-slate-500 font-mono text-[11px]">
                    {(f.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              ))}
              {selectedFolderFiles.length > 5 && (
                <span className="text-[11px] text-slate-500 text-center">
                  +{selectedFolderFiles.length - 5} more file(s)
                </span>
              )}
            </div>
          ) : (
            <div className="border border-slate-800/80 rounded-xl p-4 text-center text-xs text-slate-500">
              No local directory selected yet. Click &quot;Select Local Folder&quot; to pick real local files.
            </div>
          )}
        </div>
      )}

      {/* Action Send / Broadcast Button */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleTransmit}
          disabled={
            isTransmitting ||
            (activeTab === 'text' && !textInput.trim()) ||
            (activeTab === 'file' && !selectedFile) ||
            (activeTab === 'folder' && selectedFolderFiles.length === 0)
          }
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium text-sm transition-all shadow-lg ${
            isTransmitting
              ? 'bg-cyan-950 text-cyan-400 border border-cyan-800/80 cursor-wait'
              : 'bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white shadow-cyan-950/50 hover:shadow-cyan-900/60 active:scale-95 disabled:opacity-40 disabled:pointer-events-none'
          }`}
        >
          {isTransmitting ? (
            <>
              <Volume2 className="w-4 h-4 animate-bounce" />
              Transmitting Sound Wave...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Acoustic Drop (AirDrop via Audio)
            </>
          )}
        </button>
      </div>
    </div>
  );
};
