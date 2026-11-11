'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  ArrowUpRight,
  ArrowDownLeft,
  Download,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  FileCheck,
  HardDrive,
  Copy,
  Check,
  Radio,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AcousticBandMode,
  AcousticEngineType,
  isValidRoomToken,
} from '@/lib/audio/dsp-constants';
import { FskModulator } from '@/lib/audio/FskModulator';
import { FskDemodulator } from '@/lib/audio/FskDemodulator';
import {
  PeerConnectionManager,
  WebRTCStats,
  TransportEngineType,
} from '@/lib/webrtc/PeerConnection';
import {
  DataChannelStreamer,
  FileMetadata,
  TransferProgress,
} from '@/lib/webrtc/DataChannelManager';
import { SignalingClient } from '@/lib/webrtc/signaling';
import {
  encodeOfflineSdpToken,
  decodeOfflineSdpToken,
  encodeDirectAcousticPayload,
  decodeDirectAcousticPayload,
  WEBRTC_LAN_FAILED_MESSAGE,
} from '@/lib/webrtc/offline-sdp';
import {
  SavedFileResult,
  saveWithBrowserFsAccess,
  saveWithStreamSaver,
  formatByteSize,
} from '@/lib/storage/stream-saver';
import { RealDirectoryAnalysis } from '@/lib/storage/directory-scanner';
import {
  extractRoomIdFromPhrase,
  generateWormholePhrase,
} from '@/lib/protocols/wormhole-webtorrent';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { HairlineFigure } from '@/components/ui/HairlineFigures';
import { MorphIcon } from '@/components/ui/MorphIcon';
import { DrawablySketchBadge } from '@/components/ui/DrawablySketchBadge';
import { MetalForgeShaderOrb } from '@/components/canvas/MetalForgeShaderOrb';
import { SpectrumVisualizer } from '@/components/audio/SpectrumVisualizer';
import { AcousticTransmitter } from '@/components/audio/AcousticTransmitter';
import { AcousticReceiver } from '@/components/audio/AcousticReceiver';
import { FileDropzone } from '@/components/transfer/FileDropzone';
import { PeerCard } from '@/components/transfer/PeerCard';
import { TransferMonitor } from '@/components/transfer/TransferMonitor';
import { MeshParticleCanvas } from '@/components/canvas/MeshParticleCanvas';
import { AcousticRadarStudioWorkspace } from '@/components/studio/AcousticRadarStudioWorkspace';
import { ThreeStepTransfer } from '@/components/transfer/ThreeStepTransfer';
import { RoadmapDocsPanel } from '@/components/transfer/RoadmapDocsPanel';
import { Layers } from 'lucide-react';
import {
  MultiProtocolPanel,
  UnifiedProtocol,
  SharedClipboardEntry,
} from '@/components/transfer/MultiProtocolPanel';

type AppMode = 'IDLE' | 'TRANSMITTING' | 'RECEIVING' | 'TRANSFERRING' | 'COMPLETED' | 'ERROR';
type UnifiedWorkspaceView =
  | 'THREE_STEP_TRANSFER'
  | 'ALL_FUSED'
  | 'HUB_10_PROTOCOLS'
  | 'RADAR_16FSK_STUDIO'
  | 'PROXIMITY_PAIRING'
  | 'NATIVE_SYSTEM_50_REPOS';

export default function SoundDropApp() {
  // Primary Navigation Tab (Send vs Receive)
  const [activeTab, setActiveTab] = useState<'SEND' | 'RECEIVE'>('SEND');
  const [workspaceView, setWorkspaceView] = useState<UnifiedWorkspaceView>('THREE_STEP_TRANSFER');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [activeProtocol, setActiveProtocol] = useState<UnifiedProtocol>('ACOUSTIC');

  // Application State
  const [mode, setMode] = useState<AppMode>('IDLE');
  const [role, setRole] = useState<'initiator' | 'receiver'>('initiator');
  const [bandMode, setBandMode] = useState<AcousticBandMode>('AUDIBLE');
  const [acousticEngine, setAcousticEngine] = useState<AcousticEngineType>('GGWAVE');
  const [transportEngine, setTransportEngine] = useState<TransportEngineType>('HYBRID_AUTO');
  const [statusMessage, setStatusMessage] = useState<string>('STANDBY');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [offlineSdpToken, setOfflineSdpToken] = useState<string>('');

  // Real File & Real Directory Analysis State (Zero Mock Data)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [directoryAnalysis, setDirectoryAnalysis] = useState<RealDirectoryAnalysis | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState<string>('');
  const [transferProgress, setTransferProgress] = useState<TransferProgress>({
    bytesTransferred: 0,
    totalBytes: 0,
    currentChunk: 0,
    totalChunks: 0,
    bufferedAmount: 0,
    speedBps: 0,
  });
  const [activeMetadata, setActiveMetadata] = useState<FileMetadata | null>(null);
  const [downloadResult, setDownloadResult] = useState<SavedFileResult | null>(null);
  const [isChecksumVerified, setIsChecksumVerified] = useState<boolean | null>(null);

  // WebRTC & Audio Telemetry
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [rtcStats, setRtcStats] = useState<WebRTCStats | null>(null);
  const [incomingClipboards, setIncomingClipboards] = useState<SharedClipboardEntry[]>([]);
  const [activeRoomsList, setActiveRoomsList] = useState<
    Array<{ roomId: string; pakePhrase?: string }>
  >([]);

  // Acoustic Modulation Telemetry
  const [isAcousticEmitting, setIsAcousticEmitting] = useState<boolean>(false);
  const [acousticCurrentBit, setAcousticCurrentBit] = useState<number>(0);
  const [acousticTotalBits, setAcousticTotalBits] = useState<number>(0);
  const [acousticCurrentFreq, setAcousticCurrentFreq] = useState<number | undefined>(undefined);

  // Acoustic Demodulation & Real-Time FFT Telemetry
  const [spectralBuffer, setSpectralBuffer] = useState<Float32Array | null>(null);
  const [timeDomainBuffer, setTimeDomainBuffer] = useState<Float32Array | null>(null);
  const [dominantFreq, setDominantFreq] = useState<number | undefined>(undefined);
  const [snrDb, setSnrDb] = useState<number>(0);
  const [actualSampleRate, setActualSampleRate] = useState<number>(48000);
  const [demodStateText, setDemodStateText] = useState<string>('En attente de signal...');
  const [demodStateCode, setDemodStateCode] = useState<number>(1);

  // Manual token input & QR URL
  const [manualTokenInput, setManualTokenInput] = useState<string>('');
  const [shareUrl, setShareUrl] = useState<string>('');

  // Hardware Engine References
  const modulatorRef = useRef<FskModulator | null>(null);
  const demodulatorRef = useRef<FskDemodulator | null>(null);
  const peerRef = useRef<PeerConnectionManager | null>(null);
  const streamerRef = useRef<DataChannelStreamer | null>(null);
  const signalingRef = useRef<SignalingClient | null>(null);
  const autoChirpIntervalRef = useRef<number | null>(null);

  const cleanupEngines = useCallback(() => {
    if (autoChirpIntervalRef.current !== null) {
      clearInterval(autoChirpIntervalRef.current);
      autoChirpIntervalRef.current = null;
    }
    if (modulatorRef.current) {
      modulatorRef.current.close();
      modulatorRef.current = null;
    }
    if (demodulatorRef.current) {
      demodulatorRef.current.stop();
      demodulatorRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (signalingRef.current) {
      signalingRef.current.close();
      signalingRef.current = null;
    }
  }, []);

  // Register Service Worker for air-gapped offline operation
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => {});
    }
  }, []);

  // Poll active signaling rooms when in RECEIVE tab and online (only update state if changed)
  useEffect(() => {
    if (activeTab !== 'RECEIVE' || mode !== 'IDLE') return;
    let active = true;
    let prevSignature = '';
    const fetchActiveRooms = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try {
        const res = await fetch('/api/signal/rooms', { headers: { 'Cache-Control': 'no-store' } });
        if (!res.ok) return;
        const data = (await res.json()) as {
          rooms?: Array<{ roomId: string; pakePhrase?: string }>;
        };
        if (active && data.rooms) {
          const sig = data.rooms.map((r) => r.roomId).join(',');
          if (sig !== prevSignature) {
            prevSignature = sig;
            setActiveRoomsList(data.rooms);
          }
        }
      } catch {
        // Ignored offline
      }
    };
    void fetchActiveRooms();
    const timer = window.setInterval(() => void fetchActiveRooms(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeTab, mode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam && roomParam.trim().length >= 4) {
        const cleanToken = extractRoomIdFromPhrase(roomParam);
        setActiveTab('RECEIVE');
        setManualTokenInput(cleanToken);
        void connectReceiverToRoom(cleanToken, false);
      }
    }
    return () => {
      cleanupEngines();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetToIdle = () => {
    cleanupEngines();
    setMode('IDLE');
    setRole('initiator');
    setStatusMessage('STANDBY');
    setErrorMessage(null);
    setSelectedFile(null);
    setDirectoryAnalysis(null);
    setCurrentRoomId('');
    setOfflineSdpToken('');
    setShareUrl('');
    setTransferProgress({
      bytesTransferred: 0,
      totalBytes: 0,
      currentChunk: 0,
      totalChunks: 0,
      bufferedAmount: 0,
      speedBps: 0,
    });
    setActiveMetadata(null);
    setDownloadResult(null);
    setIsChecksumVerified(null);
    setConnectionState('new');
    setRtcStats(null);
    setIsAcousticEmitting(false);
    setAcousticCurrentBit(0);
    setAcousticTotalBits(0);
    setSpectralBuffer(null);
    setTimeDomainBuffer(null);
    setDominantFreq(undefined);
    setSnrDb(0);
    setManualTokenInput('');
  };

  const refreshLocalOfflineSdpToken = () => {
    setTimeout(() => {
      if (!peerRef.current) return;
      const { description, candidates } = peerRef.current.getLocalDescriptionAndCandidates();
      if (description) {
        setOfflineSdpToken(encodeOfflineSdpToken(description, candidates));
      }
    }, 550);
  };

  const emitChirpOnce = async (
    payload: string,
    band: AcousticBandMode,
    engine: AcousticEngineType
  ) => {
    if (!modulatorRef.current) {
      modulatorRef.current = new FskModulator();
    }
    if (modulatorRef.current.getTransmissionState()) return;
    try {
      setIsAcousticEmitting(true);
      await modulatorRef.current.transmitPayload(
        payload,
        (current, total, freq) => {
          setAcousticCurrentBit(current);
          setAcousticTotalBits(total);
          setAcousticCurrentFreq(freq);
        },
        band,
        engine,
        (spectralData, peakFreq, liveSnr, sr, timeDomain) => {
          setSpectralBuffer(spectralData);
          setTimeDomainBuffer(timeDomain);
          setDominantFreq(peakFreq);
          setSnrDb(liveSnr);
          setActualSampleRate(sr);
        }
      );
    } catch (e) {
      console.warn('Audio emission warning:', e);
    } finally {
      setIsAcousticEmitting(false);
    }
  };

  /**
   * Direct 100% Air-Gap Acoustic File Emission (0% Network / 0% Wi-Fi / 0% Internet)
   * Encodes the file payload directly into an `OFL:` Reed-Solomon acoustic frame.
   */
  const handleEmitDirectAcousticPayload = async () => {
    if (!selectedFile) return;
    setErrorMessage(null);
    // For files > 96 bytes (photos, PDFs, ZIPs), use full P2P DataChannel + Acoustic Room Beacon
    // so the file is never truncated to a 96-byte acoustic frame.
    if (selectedFile.size > 96) {
      await startTransmitter();
      return;
    }
    setStatusMessage('AIR-GAP TX');
    const frame = await encodeDirectAcousticPayload(selectedFile);
    await emitChirpOnce(frame, bandMode, 'GGWAVE');
    setStatusMessage('AIR-GAP ENVOYÉ');
  };

  /**
   * Serverless Offline WebRTC Handshake (`SDO1:...` Offer or `SDA1:...` Answer)
   * Works on local Wi-Fi or Hotspot with 0% Internet.
   */
  const handleApplyRemoteOfflineSdp = async (rawToken: string) => {
    const parsed = decodeOfflineSdpToken(rawToken);
    if (!parsed) {
      setErrorMessage('Jeton SDP Hors-Ligne invalide (format attendu : SDO1:... ou SDA1:...).');
      return;
    }

    setErrorMessage(null);

    // Case A: We are the Sender and we received the Receiver's Offline Answer (`SDA1:...`)
    if (parsed.description.type === 'answer' && peerRef.current) {
      setStatusMessage('HANDSHAKE HORS-LIGNE');
      await peerRef.current.applyAnswer(parsed.description);
      for (const cand of parsed.candidates) {
        await peerRef.current.addIceCandidate(cand);
      }
      return;
    }

    // Case B: We are the Receiver and we received the Sender's Offline Offer (`SDO1:...`)
    if (parsed.description.type === 'offer') {
      if (peerRef.current) {
        peerRef.current.close();
      }
      setRole('receiver');
      setMode('RECEIVING');
      setCurrentRoomId('OFFLINE');
      setStatusMessage('RÉPONSE HORS-LIGNE');

      peerRef.current = new PeerConnectionManager({
        onSignalNeeded: async () => {
          refreshLocalOfflineSdpToken();
        },
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          if (state === 'connected') {
            setErrorMessage(null);
            setStatusMessage('LINKED OFFLINE');
          } else if (state === 'failed') {
            setErrorMessage(WEBRTC_LAN_FAILED_MESSAGE);
            setMode('ERROR');
          }
        },
        onDataChannelReady: (channel) => {
          setErrorMessage(null);
          streamerRef.current = new DataChannelStreamer(channel);
          setMode('TRANSFERRING');
          setStatusMessage('RX OFFLINE');

          streamerRef.current.setupReceiver(
            (meta) => setActiveMetadata(meta),
            (progress) => setTransferProgress(progress),
            (result, meta, checksumValid) => {
              setDownloadResult(result);
              setActiveMetadata(meta);
              setIsChecksumVerified(checksumValid);
              setMode('COMPLETED');
              setStatusMessage('VERIFIED');
            }
          );
        },
        onStatsUpdate: (stats) => setRtcStats(stats),
      });

      await peerRef.current.handleOfferAndAnswer(parsed.description);
      for (const cand of parsed.candidates) {
        await peerRef.current.addIceCandidate(cand);
      }
      refreshLocalOfflineSdpToken();
    }
  };

  // 1. TRANSMITTER WORKFLOW (ÉMETTEUR)
  const startTransmitter = async () => {
    if (!selectedFile) return;

    try {
      cleanupEngines();
      setMode('TRANSMITTING');
      setRole('initiator');
      setErrorMessage(null);
      setStatusMessage('TX PAIRING');

      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const pakePhrase = generateWormholePhrase(roomId);
      setCurrentRoomId(roomId);
      if (typeof window !== 'undefined') {
        setShareUrl(`${window.location.origin}/?room=${roomId}`);
      }

      signalingRef.current = new SignalingClient(roomId);
      modulatorRef.current = new FskModulator();

      peerRef.current = new PeerConnectionManager({
        onSignalNeeded: async (data) => {
          refreshLocalOfflineSdpToken();
          if (data.type === 'offer') {
            try {
              signalingRef.current?.listenForAnswer(
                async (answer) => {
                  if (autoChirpIntervalRef.current !== null) {
                    clearInterval(autoChirpIntervalRef.current);
                    autoChirpIntervalRef.current = null;
                  }
                  setStatusMessage('HANDSHAKE');
                  await peerRef.current?.applyAnswer(answer);
                },
                async (candidate) => {
                  await peerRef.current?.addIceCandidate(candidate);
                }
              );

              await signalingRef.current?.registerOffer(
                data.payload as RTCSessionDescriptionInit,
                pakePhrase
              );
            } catch {
              // Offline / BroadcastChannel / QR SDP remain active
            }

            void emitChirpOnce(roomId, bandMode, acousticEngine);

            autoChirpIntervalRef.current = window.setInterval(() => {
              if (peerRef.current && peerRef.current.getConnectionState() !== 'connected') {
                void emitChirpOnce(roomId, bandMode, acousticEngine);
              }
            }, 6000);
          } else if (data.type === 'candidate') {
            await signalingRef.current?.postCandidate(
              data.payload as RTCIceCandidateInit,
              'initiator'
            );
          }
        },
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          if (state === 'connected') {
            if (autoChirpIntervalRef.current !== null) {
              clearInterval(autoChirpIntervalRef.current);
              autoChirpIntervalRef.current = null;
            }
            setStatusMessage('LINKED');
          } else if (state === 'failed') {
            setErrorMessage(WEBRTC_LAN_FAILED_MESSAGE);
            setMode('ERROR');
          }
        },
        onDataChannelReady: (channel) => {
          if (autoChirpIntervalRef.current !== null) {
            clearInterval(autoChirpIntervalRef.current);
            autoChirpIntervalRef.current = null;
          }
          streamerRef.current = new DataChannelStreamer(channel);
          setMode('TRANSFERRING');
          setStatusMessage('TX STREAMING');

          void streamerRef.current.sendFile(
            selectedFile,
            (progress) => {
              setTransferProgress(progress);
            },
            (isValid) => {
              setIsChecksumVerified(isValid);
              setMode('COMPLETED');
              setStatusMessage('VERIFIED');
            },
            directoryAnalysis
              ? {
                  isDirectoryBundle: true,
                  totalFilesInBundle: directoryAnalysis.totalFiles,
                }
              : undefined
          );
        },
        onExtraChannelReady: (extraChannel) => {
          streamerRef.current?.addCandidateChannel(extraChannel);
        },
        onStatsUpdate: (stats) => {
          setRtcStats(stats);
        },
      });

      await peerRef.current.initiateOffer(roomId, transportEngine);
      refreshLocalOfflineSdpToken();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setMode('ERROR');
    }
  };

  // 2. RECEIVER WORKFLOW (RÉCEPTEUR PAR MICROPHONE — SUPPORTE AUSSI LES PAYLOADS HORS-LIGNE `OFL:`)
  const startReceiver = async () => {
    try {
      setMode('RECEIVING');
      setRole('receiver');
      setErrorMessage(null);
      setStatusMessage('RX LISTENING');

      demodulatorRef.current = new FskDemodulator(
        async (decodedPayload) => {
          // 1. Check if this is a 100% Air-Gap Offline Direct File Frame (`OFL:<name>:<base64>`)
          const directFile = decodeDirectAcousticPayload(decodedPayload);
          if (directFile) {
            const hashBuf = await crypto.subtle.digest(
              'SHA-256',
              directFile.bytes.buffer as ArrayBuffer
            );
            const shaHex = Array.from(new Uint8Array(hashBuf))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            const blob = new Blob([directFile.bytes.buffer as ArrayBuffer], {
              type: 'application/octet-stream',
            });
            setDownloadResult({
              blob,
              url: URL.createObjectURL(blob),
              name: directFile.fileName,
              size: directFile.bytes.byteLength,
              usingOpfs: false,
              computedSha256: shaHex,
              storageEngine: 'MemoryBlob',
            });
            setIsChecksumVerified(true);
            setMode('COMPLETED');
            setStatusMessage('REÇU HORS-LIGNE');
            return;
          }

          // 2. Otherwise connect to P2P Room Token
          const cleanToken = extractRoomIdFromPhrase(decodedPayload);
          if (!isValidRoomToken(cleanToken)) {
            setStatusMessage('BRUIT REJETÉ');
            return;
          }
          setManualTokenInput(cleanToken);
          setStatusMessage(`DÉCODÉ #${cleanToken}`);
          await connectReceiverToRoom(cleanToken, true);
        },
        (spectralData, peakFreq, snr, sr, timeDomain) => {
          setSpectralBuffer(spectralData);
          if (timeDomain) setTimeDomainBuffer(timeDomain);
          setDominantFreq(peakFreq);
          setSnrDb(snr);
          setActualSampleRate(sr);
        },
        (statusText, stateCode) => {
          setDemodStateText(statusText);
          setDemodStateCode(stateCode);
        },
        bandMode,
        acousticEngine
      );

      await demodulatorRef.current.startListening();
    } catch (err) {
      setErrorMessage(
        `Microphone non disponible (${(err as Error).message}). Entrez le code ou jeton hors-ligne ci-dessous.`
      );
      setMode('IDLE');
    }
  };

  const connectReceiverToRoom = async (rawInput: string, isFromAcoustic = false) => {
    const trimmed = rawInput.trim();
    if (/^SD[OA]1:/i.test(trimmed)) {
      await handleApplyRemoteOfflineSdp(trimmed);
      return;
    }

    const cleanId = extractRoomIdFromPhrase(trimmed);
    if (!isValidRoomToken(cleanId)) {
      if (!isFromAcoustic) {
        setErrorMessage(
          `Code "${rawInput}" invalide (attendu : 6 caractères, phrase Wormhole ou jeton hors-ligne SDO1:...).`
        );
      }
      return;
    }

    try {
      if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
      }
      if (signalingRef.current) {
        signalingRef.current.close();
        signalingRef.current = null;
      }

      setCurrentRoomId(cleanId);
      setManualTokenInput(cleanId);
      setRole('receiver');
      setMode('RECEIVING');
      setErrorMessage(null);
      setStatusMessage(`JOIN #${cleanId}`);
      signalingRef.current = new SignalingClient(cleanId);

      peerRef.current = new PeerConnectionManager({
        onSignalNeeded: async (data) => {
          refreshLocalOfflineSdpToken();
          if (data.type === 'answer') {
            await signalingRef.current?.postAnswer(data.payload as RTCSessionDescriptionInit);
          } else if (data.type === 'candidate') {
            await signalingRef.current?.postCandidate(
              data.payload as RTCIceCandidateInit,
              'receiver'
            );
          }
        },
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          if (state === 'connected') {
            setErrorMessage(null);
            setStatusMessage('LINKED');
          } else if (state === 'failed') {
            setErrorMessage(WEBRTC_LAN_FAILED_MESSAGE);
            setMode('ERROR');
          }
        },
        onDataChannelReady: (channel) => {
          setErrorMessage(null);
          streamerRef.current = new DataChannelStreamer(channel);
          setMode('TRANSFERRING');
          setStatusMessage('RX STREAMING');

          streamerRef.current.setupReceiver(
            (meta) => {
              setActiveMetadata(meta);
            },
            (progress) => {
              setTransferProgress(progress);
            },
            (result, meta, checksumValid) => {
              setDownloadResult(result);
              setActiveMetadata(meta);
              setIsChecksumVerified(checksumValid);
              setMode('COMPLETED');
              setStatusMessage('VERIFIED');
            },
            (clipMsg) => {
              setIncomingClipboards((prev) => [
                {
                  id: `dc-${clipMsg.timestamp}`,
                  senderName: clipMsg.senderName,
                  payload: clipMsg.payload,
                  timestamp: clipMsg.timestamp,
                },
                ...prev,
              ]);
            }
          );
        },
        onExtraChannelReady: (extraChannel) => {
          streamerRef.current?.addCandidateChannel(extraChannel);
        },
        onStatsUpdate: (stats) => {
          setRtcStats(stats);
        },
      });

      let connectedViaPeerJs = false;
      const peerJsPromise = peerRef.current
        .connectViaPeerJs(cleanId, isFromAcoustic ? 2 : 4)
        .then((ok) => {
          if (ok) connectedViaPeerJs = true;
          return ok;
        });

      const waitTimeoutMs = isFromAcoustic ? 7500 : 15000;
      const { offer, initiatorCandidates } = await signalingRef.current.waitForRoomOffer(
        waitTimeoutMs,
        (attempt) => {
          if (peerRef.current?.getConnectionState() !== 'connected') {
            setStatusMessage(`SYNC #${cleanId} (${attempt})`);
          }
        }
      );

      if (offer && peerRef.current && peerRef.current.getConnectionState() !== 'connected') {
        signalingRef.current.listenForInitiatorCandidates(async (cand) => {
          await peerRef.current?.addIceCandidate(cand);
        });
        await peerRef.current.handleOfferAndAnswer(offer);
        for (const cand of initiatorCandidates) {
          await peerRef.current.addIceCandidate(cand);
        }
        return;
      }

      await peerJsPromise;

      if (!connectedViaPeerJs && peerRef.current?.getConnectionState() !== 'connected') {
        if (demodulatorRef.current) {
          demodulatorRef.current.resetState();
        }
        if (isFromAcoustic) {
          setCurrentRoomId('');
          setStatusMessage('RX LISTENING');
        } else {
          setStatusMessage('EN ATTENTE PAIR');
          setErrorMessage(
            `Salon "${cleanId}" introuvable ou hors-ligne. Sans Internet, utilisez le jeton SDO1:... dans l'onglet Hors-Ligne.`
          );
        }
      }
    } catch (err) {
      if (!isFromAcoustic) {
        setErrorMessage((err as Error).message);
      }
      setStatusMessage('RX LISTENING');
      if (demodulatorRef.current) {
        demodulatorRef.current.resetState();
      }
    }
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTokenInput.trim()) return;
    await connectReceiverToRoom(manualTokenInput.trim(), false);
  };

  const copyRoomCode = () => {
    if (!currentRoomId) return;
    void navigator.clipboard.writeText(currentRoomId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F4F4F6] flex flex-col items-center justify-between p-4 sm:p-6 relative overflow-x-hidden">
      {/* Audio-Reactive Constellation Particle Mesh Canvas */}
      <MeshParticleCanvas
        isActive={isAcousticEmitting || mode === 'RECEIVING'}
        snrDb={snrDb}
        dominantFreq={dominantFreq}
      />

      {/* Studio Hardware Header with nilbuild/page-mascot & morphicons */}
      <Header
        status={statusMessage}
        mode={mode}
        snrDb={snrDb}
        isP2PConnected={connectionState === 'connected'}
        isAcousticActive={isAcousticEmitting || mode === 'RECEIVING'}
        onToggleSettings={() => setShowSettings(!showSettings)}
        isSettingsOpen={showSettings}
      />

      {/* Main Responsive Studio Console (12-Column Grid on Desktop) */}
      <main id="main-content" className="w-full max-w-5xl flex flex-col gap-5 my-auto py-3 z-10">
        {/* Interactive Isometric Hairline Telemetry Strip (lucasmarkes/hairline) */}
        <section
          aria-label="Télémétrie isométrique Hairline"
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          <HairlineFigure
            variant="VAULT"
            active={Boolean(selectedFile)}
            label="SOURCE LOCALE"
            metric={
              directoryAnalysis
                ? `${directoryAnalysis.totalFiles} fichiers`
                : selectedFile
                ? `${(selectedFile.size / 1024).toFixed(1)} KB`
                : '0 fichier (Vide)'
            }
          />
          <HairlineFigure
            variant="WAVE_MATRIX"
            active={isAcousticEmitting || mode === 'RECEIVING'}
            label="MODEM ACOUSTIQUE"
            metric={snrDb > 0 ? `SNR ${snrDb.toFixed(1)} dB` : `${actualSampleRate / 1000} kHz FSK`}
          />
          <HairlineFigure
            variant="MESH_RADAR"
            active={connectionState === 'connected' || Boolean(currentRoomId)}
            label="SALON P2P / HORS-LIGNE"
            metric={currentRoomId ? `#${currentRoomId}` : 'Prêt (Online/Offline)'}
          />
          <HairlineFigure
            variant="CONVEYOR"
            active={mode === 'TRANSFERRING' || mode === 'COMPLETED'}
            label="MODE RÉSEAU"
            metric="Air-Gap & WebRTC LAN"
          />
        </section>

        {/* UNIFIED ARCHITECTURE WORKSPACE BAR — FUSING ALL 4 REPOSITORY MODULES */}
        <section
          aria-label="Sélecteur d'architecture unifiée SoundDrop"
          className="hardware-chassis rounded-2xl p-2.5 border border-white/15 flex flex-col gap-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-0.5">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#FF6A1F]" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#F4F4F6]">
                Poste de Commande SoundDrop (Version Web)
              </span>
            </div>
            <span className="font-mono text-[10px] text-[#34D399]">
              Modem ggwave WASM & WebRTC actif
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1.5 bg-[#0A0A0C] p-1.5 rounded-xl border border-white/10">
            {[
              { id: 'THREE_STEP_TRANSFER', label: '★ Parcours 3 Écrans', badge: 'PRINCIPAL' },
              { id: 'PROXIMITY_PAIRING', label: '1. Appairage Acoustique', badge: 'CHIRP' },
              { id: 'RADAR_16FSK_STUDIO', label: '2. Radar Sonore & 16-FSK', badge: 'MFSK' },
              { id: 'HUB_10_PROTOCOLS', label: '3. WebRTC LAN & Fichiers', badge: 'LAN' },
              { id: 'NATIVE_SYSTEM_50_REPOS', label: '4. Documentation & Roadmap', badge: 'DOCS' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setWorkspaceView(tab.id as UnifiedWorkspaceView)}
                className={`flex items-center justify-between gap-1.5 px-3 py-2 rounded-lg font-mono text-[11px] transition-all ${
                  workspaceView === tab.id
                    ? 'bg-[#FF5500] text-white font-bold shadow-[0_0_20px_rgba(255,85,0,0.35)]'
                    : 'bg-[#14141C] text-[#D4D4D8] hover:text-white hover:bg-[#1E1E2A]'
                }`}
              >
                <span className="truncate">{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] ${
                    workspaceView === tab.id
                      ? 'bg-black/30 text-white'
                      : 'bg-white/5 text-[#A1A1AA]'
                  }`}
                >
                  {tab.badge}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Collapsible Pro DSP & Transport Settings Drawer */}
        {showSettings && (
          <section
            id="dsp-settings-drawer"
            aria-label="Configuration DSP et Routage Réseau"
            className="hardware-chassis rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs"
          >
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#D4D4D8]">
                Bande Fréquentielle Acoustique
              </span>
              <div className="grid grid-cols-2 gap-1.5 bg-[#0A0A0C] p-1.5 rounded-xl border border-white/15">
                {(['AUDIBLE', 'ULTRASONIC'] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={bandMode === b}
                    onClick={() => {
                      setBandMode(b);
                      demodulatorRef.current?.setBandMode(b);
                    }}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg font-mono text-[11px] transition-colors ${
                      bandMode === b
                        ? 'bg-[#FF5500] text-white font-bold'
                        : 'text-[#D4D4D8] hover:text-white'
                    }`}
                  >
                    {b === 'AUDIBLE' ? 'AUDIBLE (1.8-3.6K)' : 'ULTRASONS (17.5-20K)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#D4D4D8]">
                Modulation DSP & ECC
              </span>
              <div className="grid grid-cols-3 gap-1 bg-[#0A0A0C] p-1.5 rounded-xl border border-white/15">
                {(
                  [
                    { id: 'GGWAVE', label: 'GGWAVE ECC' },
                    { id: 'SONICNET', label: 'SONICNET' },
                    { id: 'QUIET_FSK', label: 'QUIET-FSK' },
                  ] as const
                ).map((eng) => (
                  <button
                    key={eng.id}
                    type="button"
                    aria-pressed={acousticEngine === eng.id}
                    onClick={() => {
                      setAcousticEngine(eng.id);
                      demodulatorRef.current?.setEngine(eng.id);
                    }}
                    className={`min-h-[36px] px-2 py-1.5 rounded-lg font-mono text-[11px] transition-colors ${
                      acousticEngine === eng.id
                        ? 'bg-[#272732] text-white font-bold border border-white/20'
                        : 'text-[#D4D4D8] hover:text-white'
                    }`}
                  >
                    {eng.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#D4D4D8]">
                Routage WebRTC Multi-Path (Tous actifs)
              </span>
              <div className="grid grid-cols-3 gap-1 bg-[#0A0A0C] p-1.5 rounded-xl border border-white/15">
                {(
                  [
                    { id: 'HYBRID_AUTO', label: 'AUTO MESH' },
                    { id: 'PEERJS', label: 'PEERJS' },
                    { id: 'SIMPLE_PEER_EDGE', label: 'DIRECT EDGE' },
                  ] as const
                ).map((tr) => (
                  <button
                    key={tr.id}
                    type="button"
                    aria-pressed={transportEngine === tr.id}
                    onClick={() => setTransportEngine(tr.id)}
                    className={`min-h-[36px] px-2 py-1.5 rounded-lg font-mono text-[11px] transition-colors ${
                      transportEngine === tr.id
                        ? 'bg-[#272732] text-white font-bold border border-white/20'
                        : 'text-[#D4D4D8] hover:text-white'
                    }`}
                  >
                    {tr.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* PARCOURS PRINCIPAL EN 3 ÉTAPES CLAIRES (PHASE 6) */}
        {(workspaceView === 'THREE_STEP_TRANSFER' || workspaceView === 'ALL_FUSED') && (
          <section aria-label="Parcours de transfert acoustique en 3 étapes" className="w-full">
            <ThreeStepTransfer />
          </section>
        )}

        {/* MODULE 1: 2-Column 10-Protocol Studio Grid */}
        {workspaceView === 'HUB_10_PROTOCOLS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN (7 Cols): Primary File/Directory Source & P2P Session Controller */}
          <Card className="lg:col-span-7 flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-3">
                <MetalForgeShaderOrb
                  isActive={isAcousticEmitting || mode === 'RECEIVING' || mode === 'TRANSFERRING'}
                  snrDb={snrDb}
                  dominantFreq={dominantFreq || acousticCurrentFreq}
                  mode={mode}
                />
                <div>
                  <h2 className="text-base font-bold text-[#F4F4F6]">
                    Contrôleur de Transfert & Système de Fichiers
                  </h2>
                  <p className="font-mono text-xs text-[#A1A1AA] mt-0.5">
                    Partage en ligne ou 100% Hors-Ligne (Air-Gap Sonore & WebRTC LAN)
                  </p>
                </div>
              </div>
              <DrawablySketchBadge
                text={mode}
                accent={mode === 'COMPLETED' ? 'emerald' : mode === 'IDLE' ? 'sky' : 'orange'}
              />
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div
                role="alert"
                className="flex items-center gap-2.5 rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/15 p-3.5 text-xs text-[#FCA5A5]"
              >
                <AlertCircle aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-[#EF4444]" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* 1. IDLE MODE: Always-Visible Send / Receive Controls */}
            {mode === 'IDLE' && (
              <div className="flex flex-col gap-4">
                {/* Segmented Pill Switch (Send vs Receive) with MorphIcon */}
                <div
                  role="group"
                  aria-label="Mode de transfert P2P"
                  className="grid grid-cols-2 rounded-xl bg-[#0A0A0C] p-1.5 border border-white/15"
                >
                  <button
                    type="button"
                    aria-pressed={activeTab === 'SEND'}
                    onClick={() => setActiveTab('SEND')}
                    className={`min-h-[42px] flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                      activeTab === 'SEND'
                        ? 'bg-[#1E1E26] text-[#F4F4F6] shadow-sm border border-white/15'
                        : 'text-[#A1A1AA] hover:text-[#F4F4F6]'
                    }`}
                  >
                    <MorphIcon
                      state={directoryAnalysis ? 'ZIP' : selectedFile ? 'CHECK' : 'SEND'}
                      size={16}
                      className="text-[#FF6A1F]"
                    />
                    <span>Envoyer (Fichier / Dossier)</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={activeTab === 'RECEIVE'}
                    onClick={() => setActiveTab('RECEIVE')}
                    className={`min-h-[42px] flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                      activeTab === 'RECEIVE'
                        ? 'bg-[#1E1E26] text-[#F4F4F6] shadow-sm border border-white/15'
                        : 'text-[#A1A1AA] hover:text-[#F4F4F6]'
                    }`}
                  >
                    <ArrowDownLeft aria-hidden="true" className="h-4 w-4 text-[#10B981]" />
                    <span>Recevoir un transfert</span>
                  </button>
                </div>

                {activeTab === 'SEND' ? (
                  <div className="flex flex-col gap-4">
                    <FileDropzone
                      onFileSelected={(file, dirInfo) => {
                        setSelectedFile(file);
                        setDirectoryAnalysis(dirInfo || null);
                      }}
                      selectedFile={selectedFile}
                      directoryAnalysis={directoryAnalysis}
                      onClearFile={() => {
                        setSelectedFile(null);
                        setDirectoryAnalysis(null);
                      }}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <Button
                        disabled={!selectedFile}
                        onClick={() => void startTransmitter()}
                        size="lg"
                        variant="primary"
                        className="w-full"
                        icon={<ArrowUpRight aria-hidden="true" className="h-4 w-4" />}
                      >
                        {directoryAnalysis
                          ? `Transférer "${directoryAnalysis.rootName}"`
                          : 'Générer le signal P2P'}
                      </Button>

                      <Button
                        disabled={!selectedFile}
                        onClick={() => void handleEmitDirectAcousticPayload()}
                        size="lg"
                        variant="secondary"
                        className="w-full"
                        icon={<Radio aria-hidden="true" className="h-4 w-4 text-[#FF6A1F]" />}
                      >
                        Envoi Sonore Hors-Ligne (Air-Gap)
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {/* Direct 6-Char Code, Wormhole Phrase, or Offline SDP Token Input */}
                    <form onSubmit={handleManualConnect} className="space-y-2">
                      <label
                        htmlFor="manual-room-code-input"
                        className="block font-mono text-xs font-semibold text-[#D4D4D8]"
                      >
                        CODE DE SALON, PHRASE WORMHOLE OU JETON HORS-LIGNE (SDO1:...) :
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="manual-room-code-input"
                          type="text"
                          value={manualTokenInput}
                          onChange={(e) => setManualTokenInput(e.target.value)}
                          placeholder="Ex: A1B2C3, phrase PAKE ou SDO1:..."
                          className="flex-1 min-h-[44px] rounded-xl bg-[#0A0A0C] border border-white/15 px-4 py-2.5 font-mono text-sm tracking-wider text-[#F4F4F6] placeholder-[#A1A1AA]/60"
                        />
                        <Button
                          type="submit"
                          variant="primary"
                          disabled={!manualTokenInput.trim()}
                          className="px-6"
                        >
                          Joindre
                        </Button>
                      </div>
                    </form>

                    {/* Active Open Rooms Detected on Local/Edge Registry */}
                    {activeRoomsList.length > 0 && (
                      <div className="rounded-xl bg-[#121218] border border-white/15 p-3 space-y-2">
                        <span className="block font-mono text-[11px] font-semibold text-[#34D399]">
                          SALONS P2P ACTIFS DÉTECTÉS ({activeRoomsList.length}) :
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {activeRoomsList.map((r) => (
                            <button
                              key={r.roomId}
                              type="button"
                              onClick={() => void connectReceiverToRoom(r.roomId, false)}
                              className="inline-flex items-center gap-2 rounded-lg bg-[#1C1C26] hover:bg-[#FF5500] border border-white/15 px-3 py-1.5 font-mono text-xs font-bold text-[#F4F4F6] transition-colors"
                            >
                              <Radio aria-hidden="true" className="h-3.5 w-3.5 text-[#10B981]" />
                              <span>Joindre #{r.roomId}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="relative flex items-center py-1">
                      <div className="flex-grow border-t border-white/10" />
                      <span className="mx-3 flex-shrink font-mono text-[11px] uppercase tracking-widest text-[#A1A1AA]">
                        ou par décodage sonore hors-ligne
                      </span>
                      <div className="flex-grow border-t border-white/10" />
                    </div>

                    <Button
                      onClick={() => void startReceiver()}
                      variant="secondary"
                      size="lg"
                      className="w-full"
                      icon={<Mic aria-hidden="true" className="h-4 w-4 text-[#FF6A1F]" />}
                    >
                      Activer l&apos;écoute acoustique (Microphone Online & Hors-Ligne)
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* 2. TRANSMITTING STATE */}
            {mode === 'TRANSMITTING' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl bg-[#0A0A0C] border border-white/15 p-4">
                  <div className="flex flex-col justify-between space-y-1">
                    <span className="font-mono text-[11px] uppercase tracking-widest text-[#A1A1AA]">
                      CLÉ DE SESSION P2P & WORMHOLE
                    </span>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-3xl font-bold tracking-[0.18em] text-[#F4F4F6] select-all">
                        {currentRoomId}
                      </span>
                      <button
                        type="button"
                        onClick={copyRoomCode}
                        aria-label="Copier le code de session"
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-[#E4E4E7] hover:bg-white/20 hover:text-white transition-colors"
                      >
                        {copiedCode ? (
                          <Check aria-hidden="true" className="h-4 w-4 text-[#10B981]" />
                        ) : (
                          <Copy aria-hidden="true" className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <div className="font-mono text-xs text-[#34D399] select-all">
                      Phrase PAKE : {generateWormholePhrase(currentRoomId)}
                    </div>
                    <span className="font-mono text-xs text-[#A1A1AA]">
                      Saisissez ce code, scannez le QR ou activez le micro sur le récepteur
                    </span>
                  </div>

                  {shareUrl && (
                    <div className="flex-shrink-0 rounded-xl bg-white p-2.5 self-center">
                      <QRCodeSVG value={shareUrl} size={88} level="M" />
                    </div>
                  )}
                </div>

                <AcousticTransmitter
                  isEmitting={isAcousticEmitting}
                  roomId={currentRoomId}
                  currentBit={acousticCurrentBit}
                  totalBits={acousticTotalBits}
                  currentFreq={acousticCurrentFreq}
                  onReemit={() => void emitChirpOnce(currentRoomId, bandMode, acousticEngine)}
                />

                <PeerCard
                  roomId={currentRoomId}
                  role={role}
                  connectionState={connectionState}
                  stats={rtcStats}
                />

                <Button
                  variant="outline"
                  size="md"
                  onClick={resetToIdle}
                  icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                >
                  Annuler la session
                </Button>
              </div>
            )}

            {/* 3. RECEIVING STATE */}
            {mode === 'RECEIVING' && (
              <div className="flex flex-col gap-4">
                <AcousticReceiver
                  isListening={!currentRoomId}
                  snrDb={snrDb}
                  stateText={demodStateText}
                  stateCode={demodStateCode}
                />

                <form onSubmit={handleManualConnect} className="space-y-1.5">
                  <label
                    htmlFor="receiving-manual-code-input"
                    className="block font-mono text-xs text-[#D4D4D8]"
                  >
                    SAISIR UN CODE DE SALON, PHRASE WORMHOLE OU JETON SDO1:... :
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="receiving-manual-code-input"
                      type="text"
                      value={manualTokenInput}
                      onChange={(e) => setManualTokenInput(e.target.value)}
                      placeholder="Ex: A1B2C3 ou SDO1:..."
                      className="flex-1 min-h-[40px] rounded-xl bg-[#0A0A0C] border border-white/15 px-3.5 py-2 font-mono text-xs tracking-wider text-[#F4F4F6] placeholder-[#A1A1AA]/60"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      disabled={!manualTokenInput.trim()}
                    >
                      Joindre
                    </Button>
                  </div>
                </form>

                <div className="flex gap-2.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setErrorMessage(null);
                      setCurrentRoomId('');
                      if (demodulatorRef.current) {
                        demodulatorRef.current.resetState();
                      }
                      void startReceiver();
                    }}
                    icon={<RotateCcw aria-hidden="true" className="h-3.5 w-3.5 text-[#FF6A1F]" />}
                  >
                    Réécouter
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={resetToIdle}
                    icon={<RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />}
                  >
                    Arrêter l&apos;écoute
                  </Button>
                </div>
              </div>
            )}

            {/* 4. TRANSFERRING STATE */}
            {mode === 'TRANSFERRING' && (
              <div className="flex flex-col gap-4">
                <PeerCard
                  roomId={currentRoomId}
                  role={role}
                  connectionState={connectionState}
                  stats={rtcStats}
                />

                <TransferMonitor
                  progress={transferProgress}
                  metadata={
                    activeMetadata ||
                    (selectedFile
                      ? {
                          fileName: selectedFile.name,
                          fileSize: selectedFile.size,
                          fileType: selectedFile.type,
                          totalChunks: Math.ceil(selectedFile.size / (64 * 1024)),
                          sha256: '',
                        }
                      : null)
                  }
                  mode={role === 'initiator' ? 'upload' : 'download'}
                  isChecksumVerified={isChecksumVerified}
                />
              </div>
            )}

            {/* 5. COMPLETED STATE */}
            {mode === 'COMPLETED' && (
              <div className="flex flex-col gap-4 py-1">
                <div
                  role="status"
                  className="flex items-center gap-3 rounded-2xl bg-[#10B981]/15 border border-[#10B981]/35 p-4"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="h-6 w-6 text-[#10B981] flex-shrink-0"
                  />
                  <div>
                    <h3 className="text-sm font-semibold text-[#F4F4F6]">
                      Transfert complété et vérifié
                    </h3>
                    <p className="font-mono text-xs text-[#A1A1AA] mt-0.5">
                      Intégrité SHA-256 certifiée de bout en bout sans perte de paquet
                    </p>
                  </div>
                </div>

                {downloadResult && (
                  <div className="rounded-2xl bg-[#14141A] border border-white/15 p-4 flex flex-col gap-3.5">
                    <div className="flex items-center gap-3">
                      <FileCheck
                        aria-hidden="true"
                        className="h-5 w-5 text-[#FF6A1F] flex-shrink-0"
                      />
                      <div className="overflow-hidden">
                        <div className="truncate text-sm font-semibold text-[#F4F4F6]">
                          {downloadResult.name}
                        </div>
                        <div className="font-mono text-xs text-[#A1A1AA]">
                          {formatByteSize(downloadResult.size)} • Moteur{' '}
                          {downloadResult.storageEngine} • SHA-256 :{' '}
                          <code>{downloadResult.computedSha256.slice(0, 16)}…</code>
                        </div>
                      </div>
                    </div>

                    {downloadResult.size > 0 &&
                      /\.(jpe?g|png|webp|gif|svg|bmp)$/i.test(downloadResult.name) && (
                        <div className="rounded-xl overflow-hidden border border-white/10 bg-[#0A0A0C] flex items-center justify-center max-h-60">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={downloadResult.url}
                            alt={downloadResult.name}
                            className="max-h-56 w-auto object-contain"
                          />
                        </div>
                      )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => void saveWithBrowserFsAccess(downloadResult)}
                        icon={<Download aria-hidden="true" className="h-4 w-4" />}
                      >
                        Enregistrer sur le disque
                      </Button>

                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => void saveWithStreamSaver(downloadResult)}
                        icon={<HardDrive aria-hidden="true" className="h-4 w-4" />}
                      >
                        Téléchargement direct
                      </Button>
                    </div>
                  </div>
                )}

                <Button
                  variant="outline"
                  onClick={resetToIdle}
                  icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                >
                  Nouveau transfert
                </Button>
              </div>
            )}

            {/* 6. ERROR STATE */}
            {mode === 'ERROR' && (
              <div className="flex flex-col gap-3">
                <Button
                  variant="primary"
                  onClick={resetToIdle}
                  icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                >
                  Réinitialiser la session
                </Button>
              </div>
            )}
          </Card>

          {/* RIGHT COLUMN (5 Cols): Live 60fps OLED Spectrum Analyzer & Open-Source Workbench */}
          <Card className="lg:col-span-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h2 className="text-sm font-bold text-[#F4F4F6]">
                Analyseur Spectral OLED & Protocoles P2P
              </h2>
              <span className="font-mono text-[11px] text-[#34D399] font-semibold">
                ONLINE & HORS-LIGNE
              </span>
            </div>

            {/* Recessed OLED Spectrum Monitor */}
            <SpectrumVisualizer
              isActive={isAcousticEmitting || mode === 'RECEIVING'}
              spectralData={spectralBuffer}
              timeDomainData={timeDomainBuffer}
              dominantFreq={dominantFreq || acousticCurrentFreq}
              snrDb={snrDb}
              sampleRate={actualSampleRate}
              bandMode={bandMode}
              statusLabel={statusMessage}
            />

            {/* Multi-Protocol Open-Source Control Hub */}
            <MultiProtocolPanel
              selectedFile={selectedFile}
              activeProtocol={activeProtocol}
              onProtocolChange={(p) => setActiveProtocol(p)}
              currentRoomId={currentRoomId}
              liveSnrDb={snrDb}
              liveRttMs={rtcStats?.roundTripTimeMs}
              offlineSdpToken={offlineSdpToken}
              onApplyRemoteOfflineSdp={(tok) => void handleApplyRemoteOfflineSdp(tok)}
              onEmitDirectAcousticPayload={() => void handleEmitDirectAcousticPayload()}
              onJoinRoomByCode={(code) => {
                setActiveTab('RECEIVE');
                setManualTokenInput(code);
                void connectReceiverToRoom(code, false);
              }}
              onStartTransmitter={() => void startTransmitter()}
              onSendDataChannelClipboard={(sender, text) =>
                streamerRef.current ? streamerRef.current.sendClipboardMessage(sender, text) : false
              }
              incomingDataChannelClipboards={incomingClipboards}
            />
          </Card>
        </div>
        )}

        {/* MODULE 2: AirDrop Physics Bubble Radar & 16-FSK RS(80,64) FEC Studio */}
        {(workspaceView === 'ALL_FUSED' || workspaceView === 'RADAR_16FSK_STUDIO') && (
          <section aria-label="Radar Bulles AirDrop et Studio DSP 16-FSK" className="w-full flex flex-col gap-4">
            <AcousticRadarStudioWorkspace
              modeView="RADAR_STUDIO"
              globalSelectedFile={selectedFile}
              onSelectGlobalFile={(file) => setSelectedFile(file)}
              onTelemetryUpdate={(liveSnr, liveFreq) => {
                setSnrDb(liveSnr);
                if (liveFreq > 0) setDominantFreq(liveFreq);
              }}
            />
          </section>
        )}

        {/* MODULE 3: Acoustic Proximity Pairing (iPhone Emitter <-> Mac/PC Receiver) */}
        {(workspaceView === 'ALL_FUSED' || workspaceView === 'PROXIMITY_PAIRING') && (
          <section aria-label="Appairage Acoustique de Proximité iPhone vers Mac/PC" className="w-full flex flex-col gap-4">
            <AcousticRadarStudioWorkspace
              modeView="PROXIMITY_PAIRING"
              globalSelectedFile={selectedFile}
              onSelectGlobalFile={(file) => setSelectedFile(file)}
              onTelemetryUpdate={(liveSnr, liveFreq) => {
                setSnrDb(liveSnr);
                if (liveFreq > 0) setDominantFreq(liveFreq);
              }}
            />
          </section>
        )}

        {/* MODULE 4: Specifications, Documentation & Honest Roadmap */}
        {(workspaceView === 'ALL_FUSED' || workspaceView === 'NATIVE_SYSTEM_50_REPOS') && (
          <section aria-label="Feuille de Route & Documentation" className="w-full flex flex-col gap-4">
            <RoadmapDocsPanel />
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
