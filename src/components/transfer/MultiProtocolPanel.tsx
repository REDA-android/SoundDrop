'use client';

import React, { useState } from 'react';
import { Copy, Check, Radio } from 'lucide-react';

export type UnifiedProtocol =
  | 'ACOUSTIC'
  | 'OPENDROP'
  | 'LOCALSEND'
  | 'WORMHOLE_CROC'
  | 'WEBTORRENT'
  | 'SYNCTHING'
  | 'PAIRDROP'
  | 'RETICULUM_MESH'
  | 'KDE_WARPINATOR';

export interface SharedClipboardEntry {
  id: string;
  senderName: string;
  payload: string;
  timestamp: number;
}

interface MultiProtocolPanelProps {
  selectedFile: File | null;
  activeProtocol: UnifiedProtocol;
  onProtocolChange: (protocol: UnifiedProtocol) => void;
  currentRoomId?: string;
  liveSnrDb?: number;
  liveRttMs?: number;
  offlineSdpToken?: string;
  onApplyRemoteOfflineSdp?: (token: string) => void;
  onEmitDirectAcousticPayload?: () => void;
  onJoinRoomByCode?: (code: string) => void;
  onStartTransmitter?: () => void;
  onSendDataChannelClipboard?: (senderName: string, text: string) => boolean;
  incomingDataChannelClipboards?: SharedClipboardEntry[];
}

const PROTOCOL_TABS: ReadonlyArray<{
  id: UnifiedProtocol;
  label: string;
  sub: string;
  isPlanned?: boolean;
}> = [
  { id: 'ACOUSTIC', label: 'Hors-Ligne', sub: 'Air-Gap & SDP' },
  { id: 'OPENDROP', label: 'OpenDrop', sub: 'AirDrop v2', isPlanned: true },
  { id: 'LOCALSEND', label: 'LocalSend', sub: 'REST v2.1', isPlanned: true },
  { id: 'WORMHOLE_CROC', label: 'Wormhole', sub: 'PAKE / Croc', isPlanned: true },
  { id: 'WEBTORRENT', label: 'WebTorrent', sub: 'Magnet / SHA1', isPlanned: true },
  { id: 'SYNCTHING', label: 'Syncthing', sub: 'BEP 128 KB', isPlanned: true },
  { id: 'PAIRDROP', label: 'PairDrop', sub: 'Presse-Papier', isPlanned: true },
  { id: 'RETICULUM_MESH', label: 'Reticulum', sub: 'Mesh Radio', isPlanned: true },
  { id: 'KDE_WARPINATOR', label: 'Warpinator', sub: 'PIN Auth', isPlanned: true },
];

export const MultiProtocolPanel: React.FC<MultiProtocolPanelProps> = ({
  selectedFile,
  activeProtocol,
  onProtocolChange,
  offlineSdpToken = '',
  onApplyRemoteOfflineSdp,
  onEmitDirectAcousticPayload,
}) => {
  const [remoteOfflineTokenInput, setRemoteOfflineTokenInput] = useState<string>('');
  const [copiedOfflineToken, setCopiedOfflineToken] = useState<boolean>(false);

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Accessible ARIA Tablist for Protocols */}
      <div
        role="tablist"
        aria-label="Protocoles P2P et Hors-Ligne"
        className="grid grid-cols-3 gap-2 p-2 bg-[#0A0B10]/80 border border-white/[0.08] rounded-2xl shadow-inner backdrop-blur-md"
      >
        {PROTOCOL_TABS.map((p) => {
          const isSelected = activeProtocol === p.id;
          const isPlanned = Boolean(p.isPlanned);
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`tab-${p.id}`}
              aria-selected={isSelected}
              aria-controls={`panel-${p.id}`}
              onClick={() => onProtocolChange(p.id)}
              className={`min-h-[46px] px-2.5 py-2 rounded-xl transition-all flex flex-col items-center justify-center text-center ${
                isPlanned ? 'opacity-60 hover:opacity-90' : ''
              } ${
                isSelected
                  ? 'bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-transparent text-amber-300 border border-amber-500/40 shadow-md shadow-amber-500/10 font-bold'
                  : 'text-neutral-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] leading-tight font-semibold">{p.label}</span>
                {isPlanned && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/[0.05] text-neutral-500 font-mono border border-white/[0.05]">
                    Prévu
                  </span>
                )}
              </div>
              <span className="text-[9px] text-neutral-500 tracking-wider mt-0.5">{p.sub}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panel Container */}
      <div
        role="tabpanel"
        id={`panel-${activeProtocol}`}
        aria-labelledby={`tab-${activeProtocol}`}
        className="glass-panel rounded-2xl p-5 space-y-4"
      >
        {/* 1. PARTAGE 100% HORS-LIGNE (AIR-GAP SONORE DIRECT & WEBRTC LAN SANS INTERNET) */}
        {activeProtocol === 'ACOUSTIC' && (
          <div className="space-y-4">
            {/* Direct Air-Gap Acoustic File Emission */}
            <div className="rounded-xl bg-[#090A0F] border border-white/[0.08] p-4 space-y-3 shadow-inner">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-xs flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  1. TRANSFERT SONORE DIRECT (AIR-GAP 0% RÉSEAU)
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  HAUT-PARLEUR → MICRO
                </span>
              </div>
              <button
                type="button"
                disabled={!selectedFile || !onEmitDirectAcousticPayload}
                onClick={() => onEmitDirectAcousticPayload && onEmitDirectAcousticPayload()}
                className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 text-black font-bold px-4 py-2.5 text-xs transition-all shadow-[0_0_20px_rgba(245,158,11,0.2)] active:scale-[0.99]"
              >
                {selectedFile
                  ? `Diffuser "${selectedFile.name}" en ultrasons/audio`
                  : 'Sélectionnez un fichier ci-dessus pour diffuser par le son'}
              </button>
            </div>

            {/* Offline WebRTC SDP Exchange */}
            <div className="rounded-xl bg-[#090A0F] border border-white/[0.08] p-4 space-y-3 shadow-inner">
              <span className="font-bold text-white text-xs block">
                2. LIAISON WEBRTC HORS-LIGNE (ÉCHANGE DE JETONS MANUEL / ACOUSTIQUE)
              </span>

              {offlineSdpToken ? (
                <div className="space-y-2">
                  <span className="text-[11px] text-emerald-400 font-bold block">
                    Votre jeton SDP local est prêt (compressé & encodé) :
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={offlineSdpToken}
                      aria-label="Jeton SDP Hors-Ligne local"
                      className="flex-1 min-h-[40px] rounded-xl bg-[#050608] border border-white/10 px-3.5 py-2 font-mono text-[11px] text-neutral-200 shadow-inner"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(offlineSdpToken);
                        setCopiedOfflineToken(true);
                        setTimeout(() => setCopiedOfflineToken(false), 1800);
                      }}
                      className="rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 text-xs font-bold text-white flex items-center gap-1.5 transition-all active:scale-[0.98]"
                    >
                      {copiedOfflineToken ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedOfflineToken ? 'Copié' : 'Copier'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-neutral-400">
                  Lancez un envoi ci-dessus pour générer votre jeton SDP Hors-Ligne local (<code>SDO1:...</code>).
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!remoteOfflineTokenInput.trim() || !onApplyRemoteOfflineSdp) return;
                  onApplyRemoteOfflineSdp(remoteOfflineTokenInput.trim());
                  setRemoteOfflineTokenInput('');
                }}
                className="flex gap-2 pt-1"
              >
                <input
                  type="text"
                  value={remoteOfflineTokenInput}
                  onChange={(e) => setRemoteOfflineTokenInput(e.target.value)}
                  placeholder="Coller le jeton SDO1:... ou SDA1:... du pair"
                  aria-label="Coller le jeton SDP Hors-Ligne distant"
                  className="flex-1 min-h-[40px] rounded-xl bg-[#050608] border border-white/10 px-3.5 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500/50 shadow-inner"
                />
                <button
                  type="submit"
                  disabled={!remoteOfflineTokenInput.trim()}
                  className="min-h-[40px] rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-40 px-4 py-2 text-xs font-bold text-black border border-emerald-400/30 transition-all shadow-md shadow-emerald-500/20 active:scale-[0.99]"
                >
                  Lier Hors-Ligne
                </button>
              </form>
            </div>
          </div>
        )}

        {/* PROTOCOLES NATIFS PRÉVUS (HORS CHEMIN CRITIQUE WEB) */}
        {activeProtocol !== 'ACOUSTIC' && (
          <div className="rounded-xl bg-[#090A0F] border border-white/[0.08] p-6 space-y-4 text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-white/[0.04] text-neutral-400 border border-white/[0.06]">
              <span className="w-2 h-2 rounded-full bg-neutral-500" />
              <span>Protocole Prévu • Spécification Native</span>
            </div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider">
              {PROTOCOL_TABS.find((t) => t.id === activeProtocol)?.label}
            </h3>
            <p className="text-xs text-neutral-400 max-w-lg mx-auto leading-relaxed font-sans">
              Ce protocole nécessite des sockets brutes (multicast UDP local, trames 802.11 AWDL Apple direct, ou sockets TCP/TLS) qui ne peuvent pas être ouvertes dans une sandbox de navigateur web sans extensions ou daemon natif compagnon.
            </p>
            <p className="text-[11px] text-neutral-500 font-mono">
              Spécification documentée dans <span className="text-amber-400">docs/ARCHITECTURE-NATIVE.md</span> et <span className="text-cyan-400">docs/REFERENCES.md</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
