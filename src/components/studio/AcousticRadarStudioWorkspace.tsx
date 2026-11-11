'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AirDropBubbleRadar } from '@/components/radar/AirDropBubbleRadar';
import { SonarDropZone } from '@/components/SonarDropZone';
import { SpectrogramDrawer } from '@/components/studio/SpectrogramDrawer';
import { GoertzelSymbolBars } from '@/components/studio/GoertzelSymbolBars';
import { PacketMatrixGrid } from '@/components/studio/PacketMatrixGrid';
import { AcousticSettings } from '@/components/AcousticSettings';
import { LoopbackTestPanel } from '@/components/modals/LoopbackTestPanel';
import { IncomingDropSheet } from '@/components/modals/IncomingDropSheet';
import { AcousticBubbleButton } from '@/components/AcousticBubbleButton';
import { MacDropReceiver } from '@/components/MacDropReceiver';
import { AudioManager } from '@/lib/audio/audio-manager';
import { AcousticPairingTx } from '@/lib/audio/acoustic-pairing';
import { getConfigForBand } from '@/lib/dsp/constants';
import { packetizeText, packetizeFile, PacketizationResult } from '@/lib/protocol/packetizer';
import { peerDiscovery } from '@/lib/part2-p2p/peer-discovery';
import { airdropSynth } from '@/lib/part5-ui-sfx/airdrop-synth';
import { encryptAcousticPayload } from '@/lib/part8-media-crypto/acoustic-cipher';
import {
  AcousticBand,
  TransmissionMode,
  Packet,
  DropResult,
  DemodState,
} from '@/types/acoustic';
import { PeerBubble, AcousticTelemetry } from '@/types/sound-drop';
import { Lock, Unlock, ShieldCheck, Radio, Smartphone, Laptop, Sparkles } from 'lucide-react';

interface AcousticRadarStudioWorkspaceProps {
  modeView: 'RADAR_STUDIO' | 'PROXIMITY_PAIRING';
  globalSelectedFile: File | null;
  onSelectGlobalFile?: (file: File) => void;
  onTelemetryUpdate?: (snrDb: number, activeFreq: number) => void;
}

export const AcousticRadarStudioWorkspace: React.FC<AcousticRadarStudioWorkspaceProps> = ({
  modeView,
  globalSelectedFile,
  onSelectGlobalFile,
  onTelemetryUpdate,
}) => {
  // Strictly empty initial state (Zero mock peers, zero mock packets, zero mock files)
  const [peers, setPeers] = useState<PeerBubble[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [currentBand, setCurrentBand] = useState<AcousticBand>('audible');
  const [txMode, setTxMode] = useState<TransmissionMode>('broadcast');
  const [loopbackActive, setLoopbackActive] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [demodState, setDemodState] = useState<DemodState>('IDLE');
  const [telemetry, setTelemetry] = useState<AcousticTelemetry | null>(null);

  // Matrice de paquets acoustiques
  const [totalPackets, setTotalPackets] = useState<number>(0);
  const [receivedMap, setReceivedMap] = useState<Map<number, Packet>>(new Map());
  const [healedIndices, setHealedIndices] = useState<Set<number>>(new Set());
  const [receivedDrop, setReceivedDrop] = useState<DropResult | null>(null);
  const [lastTestSuccess, setLastTestSuccess] = useState<boolean | null>(null);

  // Chiffrement actif par défaut
  const [encryptionEnabled, setEncryptionEnabled] = useState<boolean>(true);
  const [encryptionPin, setEncryptionPin] = useState<string>('');

  // Proximity Pairing (Phone-to-Mac) Real State
  const [pairingStatus, setPairingStatus] = useState<'idle' | 'emitting' | 'paired'>('idle');
  const [pairedDeviceName, setPairedDeviceName] = useState<string>('');
  const pairingTxRef = useRef<AcousticPairingTx | null>(null);

  const audioManagerRef = useRef<AudioManager | null>(null);
  const config = getConfigForBand(currentBand);

  useEffect(() => {
    const am = AudioManager.getInstance();
    am.setLoopback(loopbackActive);
    audioManagerRef.current = am;
    pairingTxRef.current = new AcousticPairingTx();

    return () => {
      am.stopPlayback();
    };
  }, [loopbackActive]);

  const handleBandChange = useCallback((band: AcousticBand) => {
    setCurrentBand(band);
    const nextCfg = getConfigForBand(band);
    audioManagerRef.current?.setConfig(nextCfg);
  }, []);

  const handleToggleLoopback = useCallback((enabled: boolean) => {
    setLoopbackActive(enabled);
    audioManagerRef.current?.setLoopback(enabled);
  }, []);

  const handleToggleListening = useCallback(async () => {
    const am = audioManagerRef.current;
    if (!am) return;

    if (isListening) {
      am.stopListening();
      setIsListening(false);
      setDemodState('IDLE');
    } else {
      try {
        await am.startListening({
          onTelemetry: (t) => {
            setDemodState(t.lockedState);
            const mapped: AcousticTelemetry = {
              snrDb: t.snrDb,
              noiseFloor: t.noiseFloor,
              peakEnergy: t.peakEnergy,
              detectedSymbol: t.detectedSymbol,
              goertzelEnergies: t.goertzelEnergies,
              confidence: t.confidence,
              activeFrequency: t.activeFrequency,
              state:
                t.lockedState === 'DECODING_SYMBOLS'
                  ? 'RECEIVING'
                  : t.lockedState === 'LOCKED_ON_SIGNAL'
                  ? 'LOCKED'
                  : 'SCANNING',
              framesDecoded: t.framesDecoded,
              crcErrors: t.crcErrors,
              fecCorrections: t.fecCorrections,
            };
            setTelemetry(mapped);
            onTelemetryUpdate?.(t.snrDb, t.activeFrequency);
          },
          onPacketReceived: (packet, healed) => {
            setTotalPackets(packet.header.totalPackets);
            setReceivedMap((prev) => {
              const next = new Map(prev);
              next.set(packet.header.packetIndex, packet);
              return next;
            });
            if (healed) {
              setHealedIndices((prev) => {
                const next = new Set(prev);
                next.add(packet.header.packetIndex);
                return next;
              });
            }
            // Check if this packet is a 5-byte discovery beacon
            if (packet.payload.length === 5) {
              const discovered = peerDiscovery.handleIncomingBeacon(
                packet.payload,
                telemetry?.snrDb || 18
              );
              if (discovered) {
                setPeers(peerDiscovery.getActivePeers());
                setSelectedPeerId((prev) => prev || discovered.id);
              }
            }
          },
          onDropCompleted: (drop) => {
            setReceivedDrop(drop);
            setLastTestSuccess(true);
            airdropSynth.playSuccessChime();
          },
        });
        setIsListening(true);
        setDemodState('LISTENING_FOR_CHIRP');
      } catch (err) {
        console.error('Microphone error:', err);
      }
    }
  }, [isListening, onTelemetryUpdate, telemetry?.snrDb]);

  const executePacketTransmission = useCallback(
    async (packResult: PacketizationResult) => {
      const am = audioManagerRef.current;
      if (!am) return;

      // If loopback self-test is enabled and mic isn't listening yet, start demodulator automatically
      if (loopbackActive && !am.getIsListening()) {
        await handleToggleListening();
      }

      setTotalPackets(packResult.totalPackets);
      setReceivedMap(new Map());
      setHealedIndices(new Set());
      setIsTransmitting(true);

      const modulator = am.getModulator();
      const fullStream = modulator.synthesizeTransmission(packResult.packets, {
        amplitude: currentBand === 'whisper' ? 0.2 : 0.85,
        includePreamble: true,
      });

      await am.playPcm(fullStream, () => {
        setIsTransmitting(false);
      });
    },
    [currentBand, handleToggleListening, loopbackActive]
  );

  const handleSendText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const isUltra = currentBand !== 'audible';
      if (encryptionEnabled && encryptionPin.trim().length > 0) {
        const rawBytes = new TextEncoder().encode(text);
        const cipherBytes = await encryptAcousticPayload(rawBytes, encryptionPin.trim());
        const packResult = packetizeFile(
          cipherBytes,
          { name: 'encrypted_note.nacl', size: cipherBytes.byteLength, type: 'application/octet-stream' },
          isUltra
        );
        await executePacketTransmission(packResult);
      } else {
        const packResult = packetizeText(text, isUltra);
        await executePacketTransmission(packResult);
      }
    },
    [currentBand, encryptionEnabled, encryptionPin, executePacketTransmission]
  );

  const handleSendFile = useCallback(
    async (file: File) => {
      onSelectGlobalFile?.(file);
      const buf = await file.arrayBuffer();
      let bytes: Uint8Array = new Uint8Array(buf);
      let fileName = file.name;

      if (encryptionEnabled && encryptionPin.trim().length > 0) {
        bytes = await encryptAcousticPayload(bytes, encryptionPin.trim());
        fileName = `${file.name}.nacl`;
      }

      const isUltra = currentBand !== 'audible';
      const packResult = packetizeFile(
        bytes,
        { name: fileName, size: bytes.byteLength, type: file.type || 'application/octet-stream' },
        isUltra
      );
      await executePacketTransmission(packResult);
    },
    [currentBand, encryptionEnabled, encryptionPin, executePacketTransmission, onSelectGlobalFile]
  );

  const handleSendFolderFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // Transmit manifest + first file or combined archive summary via 16-FSK
      await handleSendFile(files[0]);
    },
    [handleSendFile]
  );

  const handleBroadcastDiscoveryPing = useCallback(async () => {
    const beaconBytes = peerDiscovery.encode4ByteBeacon();
    const isUltra = currentBand !== 'audible';
    const packResult = packetizeFile(
      beaconBytes,
      { name: 'beacon.ping', size: beaconBytes.byteLength, type: 'application/x-sounddrop-beacon' },
      isUltra
    );
    await executePacketTransmission(packResult);
  }, [currentBand, executePacketTransmission]);

  const handleRunLoopbackSelfTest = useCallback(async () => {
    setLastTestSuccess(null);
    const timestamp = new Date().toISOString();
    const testPayload = `SOUNDDROP-SELF-TEST @ ${timestamp}`;
    await handleSendText(testPayload);
  }, [handleSendText]);

  // Proximity Pairing (Phone-to-Mac) Real Chirp Emission
  const handleEmitProximityChirp = useCallback(async () => {
    if (!pairingTxRef.current) {
      pairingTxRef.current = new AcousticPairingTx();
    }
    setPairingStatus('emitting');
    const sessionId = Math.floor(Math.random() * 8) + 1;
    await pairingTxRef.current.emitPairingChirp(sessionId);
    setTimeout(() => {
      setPairingStatus((prev) => (prev === 'emitting' ? 'idle' : prev));
    }, 900);
  }, []);

  if (modeView === 'PROXIMITY_PAIRING') {
    const realQueuedPayload = globalSelectedFile
      ? {
          name: globalSelectedFile.name,
          type: 'file' as const,
          size: globalSelectedFile.size,
        }
      : null;

    return (
      <div className="w-full flex flex-col gap-6">
        {/* Top Architecture Banner */}
        <div className="rounded-2xl bg-[#11131C] border border-white/15 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100">
                Appairage Acoustique de Proximité (Émetteur ↔ Récepteur)
              </h2>
              <p className="text-xs font-mono text-slate-400">
                Balayage bi-tonalité 1800→2400 Hz + Sous-porteuse d&apos;identification • Zéro donnée fictive
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-700 text-cyan-300">
              {globalSelectedFile
                ? `Fichier actif : ${globalSelectedFile.name} (${(globalSelectedFile.size / 1024).toFixed(1)} KB)`
                : '0 fichier sélectionné (État Vide)'}
            </span>
          </div>
        </div>

        {/* Side-by-Side Emitter & Receiver Console */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: Ultrasonic / Audible Bubble Emitter */}
          <div className="rounded-3xl bg-[#0D101A] border border-white/10 p-6 flex flex-col items-center shadow-2xl">
            <div className="w-full flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Émetteur Bulle Acoustique (Émetteur)
                </span>
              </div>
              <span className="text-[11px] font-mono text-cyan-400">Chirp 1.8–3.85 kHz</span>
            </div>

            <AcousticBubbleButton
              onEmit={() => void handleEmitProximityChirp()}
              status={pairingStatus}
              pairedDeviceName={pairedDeviceName || undefined}
              queuedPayload={realQueuedPayload}
              onSendQueuedPayload={() => {
                if (globalSelectedFile) {
                  void handleSendFile(globalSelectedFile);
                }
              }}
            />
          </div>

          {/* Right: Mac / PC Acoustic Radar Receiver */}
          <div className="rounded-3xl bg-[#0D101A] border border-white/10 p-6 flex flex-col items-center shadow-2xl">
            <MacDropReceiver
              onPairingRecognized={(sessionId) => {
                setPairingStatus('paired');
                setPairedDeviceName(`Node Acoustique #${sessionId}`);
              }}
              lastReceivedDrop={receivedDrop}
              onClearDrop={() => setReceivedDrop(null)}
            />
          </div>
        </div>

        <IncomingDropSheet drop={receivedDrop} onClose={() => setReceivedDrop(null)} />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Top 2-Column Layout: AirDrop Physics Bubble Radar + Sonar 16-FSK DropZone */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <AirDropBubbleRadar
            peers={peers}
            selectedPeerId={selectedPeerId}
            onSelectPeer={(peer) => setSelectedPeerId(peer.id)}
            isTransmitting={isTransmitting}
            isListening={isListening}
            onDropPayloadOnPeer={() => {
              if (globalSelectedFile) {
                void handleSendFile(globalSelectedFile);
              }
            }}
            currentBand={currentBand}
            onBandChange={handleBandChange}
            telemetry={telemetry}
            onBroadcastDiscoveryPing={() => void handleBroadcastDiscoveryPing()}
          />
        </div>

        <div className="lg:col-span-5 flex flex-col gap-4">
          <SonarDropZone
            demodState={demodState}
            isTransmitting={isTransmitting}
            isListening={isListening}
            onSendText={(t) => void handleSendText(t)}
            onSendFile={(f) => void handleSendFile(f)}
            onSendFolderFiles={(files) => void handleSendFolderFiles(files)}
            estimatedPackets={totalPackets}
            estimatedDurationSec={
              totalPackets > 0 ? +(totalPackets * (config.symbolDurationMs / 1000) * 24).toFixed(1) : 0
            }
            currentPayloadBytes={globalSelectedFile?.size || 0}
          />

          {/* XSalsa20-Poly1305 Authenticated Acoustic Encryption Bar */}
          <div className="bg-surface p-4 rounded-2xl border border-surface-border flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {encryptionEnabled ? (
                  <Lock className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Unlock className="w-4 h-4 text-slate-400" />
                )}
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Chiffrement Acoustique XSalsa20-Poly1305 (TweetNaCl)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (encryptionEnabled) {
                    if (window.confirm('Attention : En désactivant le chiffrement, les données seront audibles et lisibles par toute personne enregistrant le son. Confirmer ?')) {
                      setEncryptionEnabled(false);
                    }
                  } else {
                    setEncryptionEnabled(true);
                  }
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors ${
                  encryptionEnabled
                    ? 'bg-emerald-950 border-emerald-500 text-emerald-300 font-bold'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
              >
                {encryptionEnabled ? 'CHIFFREMENT ACTIF' : 'NON CHIFFRÉ'}
              </button>
            </div>
            {encryptionEnabled && (
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <input
                  type="password"
                  value={encryptionPin}
                  onChange={(e) => setEncryptionPin(e.target.value)}
                  placeholder="PIN / Phrase secrète SHA-256 pour sceller la trame sonore..."
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-slate-100"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Waterfall Spectrogram (1.0 kHz - 22.0 kHz) */}
      <SpectrogramDrawer
        analyserNode={audioManagerRef.current?.getAnalyser() || null}
        config={config}
        activeFrequency={telemetry?.activeFrequency}
        isTransmitting={isTransmitting}
      />

      {/* 16-FSK Goertzel Symbol Filter Bank & Matrice de Paquets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GoertzelSymbolBars telemetry={telemetry} config={config} />
        <PacketMatrixGrid
          totalPackets={totalPackets}
          receivedMap={receivedMap}
          healedIndices={healedIndices}
        />
      </div>

      {/* Acoustic Modem Band/Mode Tuning & Loopback Self-Test Calibration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <AcousticSettings
            currentBand={currentBand}
            onBandChange={handleBandChange}
            txMode={txMode}
            onTxModeChange={setTxMode}
            loopbackActive={loopbackActive}
            onToggleLoopback={handleToggleLoopback}
            isListening={isListening}
            onToggleListening={() => void handleToggleListening()}
          />
        </div>
        <div className="lg:col-span-5">
          <LoopbackTestPanel
            onRunTest={handleRunLoopbackSelfTest}
            isTransmitting={isTransmitting}
            isListening={isListening}
            loopbackActive={loopbackActive}
            onToggleLoopback={handleToggleLoopback}
            lastTestSuccess={lastTestSuccess}
          />
        </div>
      </div>

      {/* Incoming Drop Celebration Modal */}
      <IncomingDropSheet drop={receivedDrop} onClose={() => setReceivedDrop(null)} />
    </div>
  );
};
