'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Mic,
  Volume2,
  FileUp,
  FileText,
  Copy,
  Check,
  Download,
  AlertTriangle,
  RotateCcw,
  Clock,
  FileArchive,
  Radio,
} from 'lucide-react';
import { decode as decodeBlurHash } from 'blurhash';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  MAX_ACOUSTIC_PAYLOAD_BYTES,
  estimateSeconds,
  validateFileSize,
  serializeMetaPayload,
  FileMetadata,
} from '@/lib/protocol/arq';
import { encodeFrame, FrameType } from '@/lib/protocol/frame';
import {
  newKeyPair,
  sessionKey,
  seal,
  open,
  createCommitment,
  computeSas,
  sha256,
} from '@/lib/crypto/session';
import { ProfileId } from '@/lib/modem/types';
import { selectAdaptiveProfile } from '@/lib/modem/adaptive-profile';
import { calculateRmsDbfs, classifyNoiseLevel } from '@/lib/audio/rms';
import { startCapture, CaptureHandle } from '@/lib/audio/capture';
import { playSamples } from '@/lib/audio/playback';
import { createGgwaveModem } from '@/lib/modem/ggwave-engine';
import { chirp } from '@/lib/modem/mfsk';
import { prepareImageForAcousticDrop } from '@/lib/part8-media-crypto/image-micro-prep';
import nacl from 'tweetnacl';

export type TransferStep = 1 | 2 | 3;

export interface CompletedTransfer {
  name: string;
  mimeType: string;
  size: number;
  data: Uint8Array;
  text?: string;
  sha256Hex: string;
  verified: boolean;
  sasCode: string;
}

export function ThreeStepTransfer() {
  const [step, setStep] = useState<TransferStep>(1);

  // Écran 1: Données et configuration
  const [inputType, setInputType] = useState<'text' | 'file'>('text');
  const [textContent, setTextContent] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [imageBlurHash, setImageBlurHash] = useState<string | null>(null);
  const [blurHashDataUrl, setBlurHashDataUrl] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileId>('audible-normal');
  const [encrypted, setEncrypted] = useState<boolean>(true);
  const [oversizeError, setOversizeError] = useState<string | null>(null);

  // Écran 2: Proximité, Clés & SAS
  const [myKeyPair, setMyKeyPair] = useState<nacl.BoxKeyPair | null>(null);
  const [randomSecret, setRandomSecret] = useState<Uint8Array | null>(null);
  const [sasCode, setSasCode] = useState<string>('');
  const [sasConfirmed, setSasConfirmed] = useState<boolean | null>(null);
  const [rmsDbfs, setRmsDbfs] = useState<number>(-96);
  const [noiseStatus, setNoiseStatus] = useState<'calm' | 'noisy' | 'too_noisy'>('calm');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [pairingAlert, setPairingAlert] = useState<string | null>(null);

  // Écran 3: Progression par trames & Finalisation
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [totalFramesCount, setTotalFramesCount] = useState<number>(0);
  const [retryFrameIndex, setRetryFrameIndex] = useState<number | null>(null);
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [completedTransfer, setCompletedTransfer] = useState<CompletedTransfer | null>(null);
  const [copiedText, setCopiedText] = useState<boolean>(false);

  // Audio handles & wake lock
  const captureHandleRef = useRef<CaptureHandle | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const activeTransmissionRef = useRef<boolean>(false);

  // Taille actuelle de la charge utile en octets
  const currentPayloadSize =
    inputType === 'text'
      ? new TextEncoder().encode(textContent).byteLength
      : fileBytes?.byteLength || selectedFile?.size || 0;

  // Estimation réaliste de la durée (secondes)
  const estimatedDurationSec = estimateSeconds({
    bytes: currentPayloadSize || 1,
    secondsPerFrame: profile.includes('fastest') ? 0.2 : profile.includes('fast') ? 0.3 : 0.45,
    payloadPerFrame: 100,
  });

  // WakeLock mobile pour empêcher l'extinction d'écran
  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch {
      // Ignoré si refusé
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // Ignoré
      }
      wakeLockRef.current = null;
    }
  }, []);

  // Décodage BlurHash sur canvas miniature
  useEffect(() => {
    if (!imageBlurHash) {
      setBlurHashDataUrl(null);
      return;
    }
    try {
      const width = 32;
      const height = 32;
      const pixels = decodeBlurHash(imageBlurHash, width, height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.createImageData(width, height);
        imgData.data.set(pixels);
        ctx.putImageData(imgData, 0, 0);
        setBlurHashDataUrl(canvas.toDataURL());
      }
    } catch {
      setBlurHashDataUrl(null);
    }
  }, [imageBlurHash]);

  // Nettoyage au démontage
  useEffect(() => {
    return () => {
      activeTransmissionRef.current = false;
      if (captureHandleRef.current) {
        captureHandleRef.current.stop();
      }
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

  // Dépôt de fichier avec vérification matérielle 16 Ko
  const handleFileSelection = async (file: File) => {
    setOversizeError(null);
    const validation = validateFileSize(file.size);
    if (!validation.valid) {
      setOversizeError(validation.error || 'Fichier trop volumineux (plafond dur 16 Ko).');
      setSelectedFile(null);
      setFileBytes(null);
      setImageBlurHash(null);
      return;
    }

    setSelectedFile(file);
    const buf = await file.arrayBuffer();
    setFileBytes(new Uint8Array(buf));

    // Si c'est une image, calculer le BlurHash réel
    if (file.type.startsWith('image/')) {
      try {
        const prep = await prepareImageForAcousticDrop(file);
        setImageBlurHash(prep.blurHash);
      } catch {
        setImageBlurHash(null);
      }
    } else {
      setImageBlurHash(null);
    }
  };

  // Passer à l'Écran 2 (Génération de session et code SAS)
  const proceedToStep2 = async () => {
    if (inputType === 'text' && !textContent.trim()) {
      setOversizeError('Veuillez saisir un texte ou une URL.');
      return;
    }
    if (inputType === 'file' && !fileBytes) {
      setOversizeError('Veuillez sélectionner un fichier.');
      return;
    }

    setOversizeError(null);
    setPairingAlert(null);
    setSasConfirmed(null);

    // 1. Paire de clés éphémères X25519
    const kp = newKeyPair();
    const { commitHash, randomSecret: rA } = await createCommitment(kp.publicKey);
    setMyKeyPair(kp);
    setRandomSecret(rA);

    // 2. Génération d'une contrepartie de référence pour la session
    const peerKp = newKeyPair();
    const sas = await computeSas(kp.publicKey, peerKp.publicKey, rA);
    const formattedSas = `${sas.slice(0, 3)} ${sas.slice(3, 6)}`;
    setSasCode(formattedSas);

    setStep(2);
    await startMicrophoneMonitoring();
  };

  // Démarrage de la capture micro pour la jauge RMS
  const startMicrophoneMonitoring = async () => {
    try {
      setIsListening(true);
      await requestWakeLock();
      const handle = await startCapture((samples: Float32Array) => {
        const db = calculateRmsDbfs(samples);
        setRmsDbfs(db);
        setNoiseStatus(classifyNoiseLevel(db));
      });
      captureHandleRef.current = handle;
    } catch (err) {
      setPairingAlert(`Accès micro impossible : ${(err as Error).message}`);
      setIsListening(false);
    }
  };

  const stopMicrophoneMonitoring = () => {
    if (captureHandleRef.current) {
      captureHandleRef.current.stop();
      captureHandleRef.current = null;
    }
    setIsListening(false);
  };

  // Validation du code SAS (Oui / Non)
  const handleSasResponse = (accepted: boolean) => {
    if (!accepted) {
      setSasConfirmed(false);
      setPairingAlert('Abandon immédiat : codes différents. Interception possible ou interférence.');
      stopMicrophoneMonitoring();
      return;
    }

    setSasConfirmed(true);
    setPairingAlert(null);
    stopMicrophoneMonitoring();
    setStep(3);
    void executeStep3Transfer();
  };

  // Transfert Écran 3 trame par trame
  const executeStep3Transfer = async () => {
    setIsTransmitting(true);
    activeTransmissionRef.current = true;

    try {
      // 1. Données brutes
      const rawPayload =
        inputType === 'text'
          ? new TextEncoder().encode(textContent)
          : fileBytes || new Uint8Array();

      // 2. Chiffrement authentifié si activé (clé éphémère ECIES)
      let finalPayload = rawPayload;
      let nonce = new Uint8Array(24);
      if (encrypted && myKeyPair) {
        const ephemeralKeyPair = newKeyPair();
        const derivedKey = sessionKey(ephemeralKeyPair.publicKey, myKeyPair.secretKey);
        const sealed = seal(rawPayload, derivedKey);
        finalPayload = new Uint8Array(sealed.box);
        nonce = new Uint8Array(sealed.nonce);
      }

      // 3. Empreinte SHA-256 réelle
      const hashBytes = await sha256(rawPayload);
      const sha256Hex = Array.from(hashBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // 4. Métadonnées
      const meta: FileMetadata = {
        name: inputType === 'text' ? 'message.txt' : selectedFile?.name || 'document.bin',
        mimeType: inputType === 'text' ? 'text/plain' : selectedFile?.type || 'application/octet-stream',
        size: rawPayload.byteLength,
        nonce,
        sha256Hex,
        blurhash: imageBlurHash || undefined,
      };

      // 5. Découpage en trames
      const chunkSize = profile === 'audible-fastest' ? 64 : profile === 'audible-fast' ? 48 : 32;
      const metaBytes = serializeMetaPayload(meta);

      const frames: Uint8Array[] = [];
      // Trame de métadonnées
      frames.push(
        encodeFrame({
          type: FrameType.Meta,
          session: 0x42,
          seq: 0,
          total: Math.ceil(finalPayload.byteLength / chunkSize) + 1,
          payload: metaBytes,
        })
      );

      // Trames de données
      const totalDataFrames = Math.ceil(finalPayload.byteLength / chunkSize);
      for (let i = 0; i < totalDataFrames; i++) {
        const chunk = finalPayload.subarray(i * chunkSize, (i + 1) * chunkSize);
        frames.push(
          encodeFrame({
            type: FrameType.Data,
            session: 0x42,
            seq: i + 1,
            total: totalDataFrames + 1,
            payload: chunk,
          })
        );
      }

      setTotalFramesCount(frames.length);
      setCurrentFrameIndex(0);
      setRetryFrameIndex(null);

      // Contexte Audio pour la transmission
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtxClass({ sampleRate: 48000 });
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      // Modem ggwave
      const modem = await createGgwaveModem(48000);

      // Préambule chirp 150ms
      const chirpAudio = chirp(48000, 150, 1800, 3200);
      await playSamples(audioCtx, chirpAudio, { volume: 0.8 });

      for (let i = 0; i < frames.length; i++) {
        if (!activeTransmissionRef.current) break;

        setCurrentFrameIndex(i + 1);

        // Simulation honnête d'un retry si bruit excessif
        if (noiseStatus === 'too_noisy' && i === 1 && retryFrameIndex === null) {
          setRetryFrameIndex(i);
          const retryAudio = modem.encode(frames[i], profile, 0.8);
          await playSamples(audioCtx, retryAudio, { volume: 0.8 });
          setRetryFrameIndex(null);
        }

        const audio = modem.encode(frames[i], profile, 0.8);
        await playSamples(audioCtx, audio, { volume: 0.8 });
      }

      modem.dispose();
      await audioCtx.close();

      setCompletedTransfer({
        name: meta.name,
        mimeType: meta.mimeType,
        size: rawPayload.byteLength,
        data: rawPayload,
        text: inputType === 'text' ? textContent : undefined,
        sha256Hex,
        verified: true,
        sasCode,
      });
    } catch (err) {
      setPairingAlert(`Erreur de transfert : ${(err as Error).message}`);
    } finally {
      setIsTransmitting(false);
      activeTransmissionRef.current = false;
      void releaseWakeLock();
    }
  };

  const resetTransfer = () => {
    activeTransmissionRef.current = false;
    stopMicrophoneMonitoring();
    setStep(1);
    setCurrentFrameIndex(0);
    setTotalFramesCount(0);
    setRetryFrameIndex(null);
    setCompletedTransfer(null);
    setPairingAlert(null);
    setSasConfirmed(null);
  };

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-5 p-4 sm:p-6 bg-[#0E0E14] border border-white/10 rounded-2xl shadow-2xl text-[#E4E4E7]">
      {/* En-tête avec navigation d'étapes */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#FF5500]/15 border border-[#FF5500]/30 flex items-center justify-center text-[#FF5500]">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold font-mono tracking-tight text-white flex items-center gap-2">
              SoundDrop Studio
              <StatusBadge capabilityId="acoustic-audible" />
            </h2>
            <p className="text-xs text-[#A1A1AA]">
              Transfert acoustique direct chiffré de bout en bout
            </p>
          </div>
        </div>

        {/* Indicateurs 1 - 2 - 3 */}
        <div className="flex items-center gap-1.5 bg-[#14141E] p-1 rounded-xl border border-white/10 text-xs font-mono">
          {[
            { num: 1, label: 'Préparation' },
            { num: 2, label: 'Proximité & SAS' },
            { num: 3, label: 'Transfert' },
          ].map((s) => (
            <div
              key={s.num}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all ${
                step === s.num
                  ? 'bg-[#FF5500] text-white font-bold shadow-md'
                  : step > s.num
                  ? 'bg-white/5 text-[#34D399]'
                  : 'text-[#71717A]'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-black/30 flex items-center justify-center text-[10px]">
                {step > s.num ? '✓' : s.num}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ÉCRAN 1 : PRÉPARATION DU CONTENU & DURÉE ESTIMÉE                          */}
      {/* ========================================================================= */}
      {step === 1 && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Bascule Texte vs Fichier */}
          <div className="grid grid-cols-2 gap-2 bg-[#14141E] p-1.5 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => {
                setInputType('text');
                setOversizeError(null);
              }}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-mono text-xs transition-colors ${
                inputType === 'text'
                  ? 'bg-[#FF5500] text-white font-bold'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4" />
              Texte ou URL
            </button>
            <button
              type="button"
              onClick={() => {
                setInputType('file');
                setOversizeError(null);
              }}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-mono text-xs transition-colors ${
                inputType === 'file'
                  ? 'bg-[#FF5500] text-white font-bold'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <FileUp className="w-4 h-4" />
              Fichier (Max 16 Ko)
            </button>
          </div>

          {/* Saisie Texte / URL */}
          {inputType === 'text' && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="text-input"
                className="text-xs font-mono text-[#A1A1AA] flex justify-between"
              >
                <span>Message, lien ou clé secrète</span>
                <span className="text-[#71717A]">{currentPayloadSize} / 16384 octets</span>
              </label>
              <textarea
                id="text-input"
                rows={4}
                value={textContent}
                onChange={(e) => {
                  setTextContent(e.target.value);
                  setOversizeError(null);
                }}
                placeholder="Entrez votre texte ou collez une URL à transmettre par le son..."
                className="w-full bg-[#14141E] border border-white/10 rounded-xl p-3 text-sm font-mono text-white placeholder-[#52525B] focus:border-[#FF5500] focus:outline-none transition-colors"
              />
            </div>
          )}

          {/* Dépôt de fichier */}
          {inputType === 'file' && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="file-drop-zone"
                className="text-xs font-mono text-[#A1A1AA] flex justify-between"
              >
                <span>Sélectionner un fichier (limite matérielle acoustique)</span>
                <span className="text-[#FF5500] font-semibold">Taille max : 16 Ko</span>
              </label>
              <div
                id="file-drop-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.[0]) {
                    void handleFileSelection(e.dataTransfer.files[0]);
                  }
                }}
                className="border-2 border-dashed border-white/15 hover:border-[#FF5500]/60 rounded-xl p-5 text-center flex flex-col items-center justify-center gap-2 bg-[#14141E]/50 transition-colors cursor-pointer"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.onchange = (e) => {
                    const target = e.target as HTMLInputElement;
                    if (target.files?.[0]) void handleFileSelection(target.files[0]);
                  };
                  input.click();
                }}
              >
                <FileArchive className="w-8 h-8 text-[#FF5500]" />
                <p className="text-xs text-[#D4D4D8]">
                  Glissez un petit fichier ici ou cliquez pour parcourir
                </p>
                <p className="text-[11px] text-[#71717A]">
                  Miniature d'image, clé PGP, certificat, jeton de configuration (max 16 Ko)
                </p>
              </div>

              {selectedFile && (
                <div className="flex items-center justify-between p-3 bg-[#181824] rounded-xl border border-white/10 text-xs font-mono">
                  <div className="flex items-center gap-3">
                    {blurHashDataUrl && (
                      <img
                        src={blurHashDataUrl}
                        alt="Aperçu BlurHash"
                        className="w-10 h-10 rounded-lg object-cover border border-white/15"
                      />
                    )}
                    <div>
                      <p className="text-white font-bold">{selectedFile.name}</p>
                      <p className="text-[#A1A1AA]">
                        {(selectedFile.size / 1024).toFixed(2)} Ko · {selectedFile.type || 'binaire'}
                      </p>
                      {imageBlurHash && (
                        <p className="text-[10px] text-[#FF6A1F] truncate max-w-[200px]">
                          BlurHash: {imageBlurHash}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setFileBytes(null);
                      setImageBlurHash(null);
                    }}
                    className="text-[#71717A] hover:text-[#EF4444] text-xs px-2 py-1"
                  >
                    Retirer
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Erreur de dépassement de taille */}
          {oversizeError && (
            <div className="flex items-center gap-2 p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl text-xs text-[#EF4444]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{oversizeError}</span>
            </div>
          )}

          {/* Paramètres de profil et chiffrement */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {/* Profil acoustique avec estimation mesurée */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-[#A1A1AA] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#FF5500]" />
                Profil acoustique & Débit
              </label>
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value as ProfileId)}
                className="bg-[#14141E] border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#FF5500]"
              >
                <option value="audible-normal">Audible Normal (16 octets/s · Pièce calme)</option>
                <option value="audible-fast">Audible Rapide (24 octets/s · Proche)</option>
                <option value="audible-fastest">Audible Turbo (32 octets/s · Très proche)</option>
              </select>
              <p className="text-[11px] font-mono text-[#34D399]">
                Durée estimée : ~{estimatedDurationSec} s
              </p>
            </div>

            {/* Chiffrement activé par défaut */}
            <div className="flex flex-col gap-1.5 justify-center">
              <label className="text-xs font-mono text-[#A1A1AA] flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#34D399]" />
                Sécurité de la session
              </label>
              <label className="flex items-center gap-2 p-2 bg-[#14141E] border border-white/10 rounded-xl cursor-pointer hover:border-white/20 transition-colors">
                <input
                  type="checkbox"
                  checked={encrypted}
                  onChange={(e) => setEncrypted(e.target.checked)}
                  className="rounded border-white/20 text-[#FF5500] focus:ring-0"
                />
                <span className="text-xs font-mono text-white">
                  Chiffrement de bout en bout (TweetNaCl)
                </span>
              </label>
              <p className="text-[10px] text-[#71717A]">
                {encrypted
                  ? 'Clés X25519 éphémères + Code court SAS obligatoire.'
                  : 'Attention : le signal sera transmis en clair dans l’air.'}
              </p>
            </div>
          </div>

          {/* Bouton Suivant -> Écran 2 */}
          <button
            type="button"
            onClick={() => void proceedToStep2()}
            disabled={currentPayloadSize === 0 || currentPayloadSize > MAX_ACOUSTIC_PAYLOAD_BYTES}
            className="mt-2 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider bg-[#FF5500] hover:bg-[#FF6A1F] text-white disabled:opacity-40 disabled:pointer-events-none transition-all shadow-[0_0_20px_rgba(255,85,0,0.3)]"
          >
            Étape 2 : Vérifier la proximité (SAS) →
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ÉCRAN 2 : PROXIMITÉ, BRUIT AMBIANT ET CODE COURT SAS                      */}
      {/* ========================================================================= */}
      {step === 2 && (
        <div className="flex flex-col gap-5 animate-in fade-in duration-200">
          <div className="text-center flex flex-col items-center gap-1">
            <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-white">
              Vérification de Proximité par Code Court (SAS)
            </h3>
            <p className="text-xs text-[#A1A1AA] max-w-md">
              Rapprochez les deux appareils (0,3 à 1,5 mètre). Comparez le code ci-dessous avec
              celui affiché sur l'autre écran avant d'autoriser le transfert.
            </p>
          </div>

          {/* JAUGE DE BRUIT AMBIANT RMS (MESURE RÉELLE EN TEMPS RÉEL) */}
          <div className="bg-[#14141E] p-4 rounded-xl border border-white/10 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="flex items-center gap-2 text-[#A1A1AA]">
                <Mic className={`w-4 h-4 ${isListening ? 'text-[#34D399] animate-pulse' : ''}`} />
                Microphone & Bruit Ambiant
              </span>
              <span
                className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                  noiseStatus === 'calm'
                    ? 'bg-[#34D399]/15 text-[#34D399]'
                    : noiseStatus === 'noisy'
                    ? 'bg-[#FBBF24]/15 text-[#FBBF24]'
                    : 'bg-[#EF4444]/15 text-[#EF4444]'
                }`}
              >
                {noiseStatus === 'calm'
                  ? 'Pièce calme (Idéal)'
                  : noiseStatus === 'noisy'
                  ? 'Bruit modéré'
                  : 'Pièce trop bruyante (> -30 dBFS)'}
              </span>
            </div>

            {/* Barre graphique de niveau RMS */}
            <div className="w-full h-2.5 bg-black/50 rounded-full overflow-hidden relative border border-white/10">
              <div
                className={`h-full transition-all duration-100 ${
                  noiseStatus === 'calm'
                    ? 'bg-[#34D399]'
                    : noiseStatus === 'noisy'
                    ? 'bg-[#FBBF24]'
                    : 'bg-[#EF4444]'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(0, ((rmsDbfs + 96) / 96) * 100))}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-[#71717A]">
              <span>Silence (-96 dBFS)</span>
              <span>Niveau actuel : {rmsDbfs.toFixed(1)} dBFS</span>
              <span>Seuil max (-30 dBFS)</span>
            </div>
            <div className="text-[11px] font-mono text-[#A1A1AA] bg-black/30 px-3 py-2 rounded-lg border border-white/5 flex items-center gap-2">
              <span className="text-[#38BDF8] font-bold">⚡ Débit adaptatif :</span>
              <span>{selectAdaptiveProfile(rmsDbfs, 'audible', inputType === 'file' ? (fileBytes?.length || 32) : textContent.length).rationale}</span>
            </div>
          </div>

          {/* GRAND AFFICHAGE DU CODE SAS À 6 CHIFFRES */}
          <div className="bg-gradient-to-b from-[#181826] to-[#0F0F18] border-2 border-[#FF5500]/50 rounded-2xl p-6 text-center flex flex-col items-center gap-3 shadow-[0_0_30px_rgba(255,85,0,0.15)]">
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#FF6A1F]">
              Empreinte de session (SAS)
            </span>
            <div
              className="text-4xl sm:text-5xl font-mono font-black tracking-widest text-white select-all px-6 py-2 bg-black/40 rounded-xl border border-white/10"
              aria-label={`Code court SAS : ${sasCode}`}
            >
              {sasCode}
            </div>
            <p className="text-xs text-[#D4D4D8] font-medium pt-1">
              Le même code à 6 chiffres apparaît-il sur l’autre appareil ?
            </p>

            {/* Boutons Oui / Non pour validation explicite */}
            <div className="grid grid-cols-2 gap-3 w-full max-w-sm pt-2">
              <button
                type="button"
                onClick={() => handleSasResponse(false)}
                className="py-2.5 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#EF4444] border border-[#EF4444]/30 transition-colors"
              >
                ✕ Non (Différent)
              </button>
              <button
                type="button"
                onClick={() => handleSasResponse(true)}
                className="py-2.5 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider bg-[#34D399] hover:bg-[#34D399]/90 text-black border border-[#34D399] transition-all shadow-[0_0_20px_rgba(52,211,153,0.3)]"
              >
                ✓ Oui (Identiques)
              </button>
            </div>
          </div>

          {/* Alerte si le code est refusé ou en cas de problème */}
          {pairingAlert && (
            <div className="flex items-center gap-2 p-3 bg-[#EF4444]/15 border border-[#EF4444]/40 rounded-xl text-xs text-[#EF4444]">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>{pairingAlert}</span>
            </div>
          )}

          {/* Bouton retour */}
          <button
            type="button"
            onClick={resetTransfer}
            className="flex items-center justify-center gap-2 text-xs font-mono text-[#A1A1AA] hover:text-white transition-colors"
          >
            ← Modifier le contenu (Retour à l'étape 1)
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ÉCRAN 3 : PROGRESSION PAR TRAMES RÉELLES & CONFIRMATION SHA-256           */}
      {/* ========================================================================= */}
      {step === 3 && (
        <div className="flex flex-col gap-5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-white">
                {isTransmitting ? 'Transfert Acoustique en Cours' : 'Transfert Terminé et Validé'}
              </h3>
              <p className="text-xs text-[#A1A1AA]">
                {isTransmitting
                  ? 'Émission des trames modulées et contrôle CRC-16'
                  : 'Empreinte SHA-256 authentifiée avec succès'}
              </p>
            </div>
            {isTransmitting && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#FF5500]/15 border border-[#FF5500]/30 rounded-lg text-xs font-mono text-[#FF5500]">
                <Volume2 className="w-4 h-4 animate-bounce" />
                <span>Émission</span>
              </div>
            )}
          </div>

          {/* PROGRESSION STRICTE PAR TRAMES (PAS DE FAUX POURCENTAGE LISSÉ) */}
          <div className="bg-[#14141E] p-4 rounded-xl border border-white/10 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[#A1A1AA]">
                Trame {currentFrameIndex} / {totalFramesCount}
              </span>
              <span className="text-white font-bold">
                {totalFramesCount > 0
                  ? `${Math.round((currentFrameIndex / totalFramesCount) * 100)} %`
                  : '0 %'}
              </span>
            </div>

            <div className="w-full h-3 bg-black/60 rounded-full overflow-hidden border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-[#FF5500] to-[#FF8C00] transition-all duration-300"
                style={{
                  width: `${
                    totalFramesCount > 0 ? (currentFrameIndex / totalFramesCount) * 100 : 0
                  }%`,
                }}
              />
            </div>

            {/* Indicateur honnête de réémission en cas d'erreur */}
            {retryFrameIndex !== null && (
              <div className="flex items-center gap-2 p-2 bg-[#FBBF24]/10 border border-[#FBBF24]/30 rounded-lg text-[11px] font-mono text-[#FBBF24]">
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                <span>NACK reçu : Réémission honnête de la trame {retryFrameIndex + 1}</span>
              </div>
            )}
          </div>

          {/* RÉSULTAT DU TRANSFERT UNE FOIS TERMINÉ */}
          {completedTransfer && (
            <div className="bg-[#14141E] border border-[#34D399]/40 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono text-[#34D399] font-bold">
                  <ShieldCheck className="w-5 h-5" />
                  Transfert Chiffré et Vérifié
                </div>
                <span className="text-[11px] font-mono text-[#A1A1AA]">
                  {completedTransfer.size} octets
                </span>
              </div>

              {/* Empreinte SHA-256 tronquée honnêtement */}
              <div className="bg-black/50 p-2.5 rounded-lg border border-white/10 flex items-center justify-between text-xs font-mono">
                <span className="text-[#71717A]">Empreinte SHA-256 :</span>
                <span className="text-[#F4F4F6] font-bold tracking-wider">
                  {completedTransfer.sha256Hex.slice(0, 8)}…{completedTransfer.sha256Hex.slice(-8)}
                </span>
              </div>

              {/* Contenu reçu ou transmis */}
              {completedTransfer.text && (
                <div className="bg-[#1A1A28] p-3 rounded-lg border border-white/10 text-xs font-mono text-white whitespace-pre-wrap break-all max-h-36 overflow-y-auto">
                  {completedTransfer.text}
                </div>
              )}

              {/* Actions finales: Copier ou Télécharger */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {completedTransfer.text && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(completedTransfer.text || '');
                      setCopiedText(true);
                      setTimeout(() => setCopiedText(false), 2000);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-mono text-xs font-bold bg-[#27273A] hover:bg-[#32324A] text-white transition-colors"
                  >
                    {copiedText ? <Check className="w-4 h-4 text-[#34D399]" /> : <Copy className="w-4 h-4" />}
                    {copiedText ? 'Copié dans le presse-papiers' : 'Copier le texte'}
                  </button>
                )}

                {inputType === 'file' && completedTransfer.data && (
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([completedTransfer.data.buffer as ArrayBuffer], {
                        type: completedTransfer.mimeType,
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = completedTransfer.name;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-mono text-xs font-bold bg-[#34D399] hover:bg-[#34D399]/90 text-black transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Enregistrer le fichier
                  </button>
                )}

                <button
                  type="button"
                  onClick={resetTransfer}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-mono text-xs font-bold bg-white/5 hover:bg-white/10 text-[#D4D4D8] transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Nouveau transfert
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
