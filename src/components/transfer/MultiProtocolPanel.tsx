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
        className="grid grid-cols-3 gap-1.5 p-1.5 bg-[#0C0C10] border border-white/15 rounded-2xl"
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
              className={`min-h-[44px] px-2 py-1.5 rounded-xl transition-all flex flex-col items-center justify-center text-center ${
                isPlanned ? 'opacity-60 hover:opacity-85' : ''
              } ${
                isSelected
                  ? 'bg-[#1E1E28] text-[#FF7A33] border border-[#FF5500]/50 shadow-sm font-bold'
                  : 'text-[#D4D4D8] hover:text-white hover:bg-[#16161E] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="text-[11px] leading-tight">{p.label}</span>
                {isPlanned && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                    Prévu
                  </span>
                )}
              </div>
              <span className="text-[9px] text-[#A1A1AA] tracking-wider mt-0.5">{p.sub}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panel Container */}
      <div
        role="tabpanel"
        id={`panel-${activeProtocol}`}
        aria-labelledby={`tab-${activeProtocol}`}
        className="rounded-2xl bg-[#121217] border border-white/15 p-4 space-y-3.5"
      >
        {/* 1. PARTAGE 100% HORS-LIGNE (AIR-GAP SONORE DIRECT & WEBRTC LAN SANS INTERNET) */}
        {activeProtocol === 'ACOUSTIC' && (
          <div className="space-y-3">
            {/* Direct Air-Gap Acoustic File Emission */}
            <div className="rounded-xl bg-[#0C0C10] border border-white/15 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#F4F4F6] text-xs">
                  1. TRANSFERT SONORE DIRECT (AIR-GAP 0% RÉSEAU)
                </span>
                <span className="text-[10px] text-[#34D399] font-semibold">HAUT-PARLEUR → MICRO</span>
              </div>
              <button
                type="button"
                disabled={!selectedFile || !onEmitDirectAcousticPayload}
                onClick={() => onEmitDirectAcousticPayload && onEmitDirectAcousticPayload()}
                className="w-full min-h-[40px] rounded-xl bg-[#FF5500] hover:bg-[#FF6A1F] disabled:opacity-40 text-white font-bold px-3 py-2 text-xs transition-colors"
              >
                {selectedFile
                  ? `Diffuser "${selectedFile.name}" en ultrasons/audio`
                  : 'Sélectionnez un fichier ci-dessus pour diffuser par le son'}
              </button>
            </div>

            {/* Offline WebRTC SDP Exchange */}
            <div className="rounded-xl bg-[#0C0C10] border border-white/15 p-3 space-y-2.5">
              <span className="font-bold text-[#F4F4F6] text-xs block">
                2. LIAISON WEBRTC HORS-LIGNE (ÉCHANGE DE JETONS MANUEL / ACOUSTIQUE)
              </span>

              {offlineSdpToken ? (
                <div className="space-y-1.5">
                  <span className="text-[11px] text-[#34D399] font-bold block">
                    Votre jeton SDP local est prêt (compressé & encodé) :
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={offlineSdpToken}
                      aria-label="Jeton SDP Hors-Ligne local"
                      className="flex-1 min-h-[38px] rounded-xl bg-[#14141C] border border-white/15 px-3 py-1.5 font-mono text-[11px] text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(offlineSdpToken);
                        setCopiedOfflineToken(true);
                        setTimeout(() => setCopiedOfflineToken(false), 1800);
                      }}
                      className="rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold text-white flex items-center gap-1"
                    >
                      {copiedOfflineToken ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedOfflineToken ? 'Copié' : 'Copier'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-[#A1A1AA]">
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
                  className="flex-1 min-h-[38px] rounded-xl bg-[#14141C] border border-white/15 px-3 py-1.5 text-xs text-[#F4F4F6] placeholder-[#A1A1AA]/60"
                />
                <button
                  type="submit"
                  disabled={!remoteOfflineTokenInput.trim()}
                  className="min-h-[38px] rounded-xl bg-[#10B981] hover:bg-[#059669] disabled:opacity-40 px-3.5 py-1.5 text-xs font-bold text-slate-950 transition-colors"
                >
                  Lier Hors-Ligne
                </button>
              </form>
            </div>
          </div>
        )}

        {/* PROTOCOLES NATIFS PRÉVUS (HORS CHEMIN CRITIQUE WEB) */}
        {activeProtocol !== 'ACOUSTIC' && (
          <div className="rounded-xl bg-[#0C0C10] border border-white/10 p-6 space-y-4 text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
              <span className="w-2 h-2 rounded-full bg-zinc-400" />
              <span>Protocole Prévu • Pas encore disponible</span>
            </div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider">
              {PROTOCOL_TABS.find((t) => t.id === activeProtocol)?.label}
            </h3>
            <p className="text-xs text-[#A1A1AA] max-w-lg mx-auto leading-relaxed font-sans">
              Ce protocole nécessite des sockets brutes (multicast UDP local, trames 802.11 AWDL Apple direct, ou sockets TCP/TLS) qui ne peuvent pas être ouvertes dans une sandbox de navigateur web sans extensions ou daemon natif compagnon.
            </p>
            <p className="text-[11px] text-zinc-500 font-mono">
              Spécification documentée dans <span className="text-orange-400">docs/ARCHITECTURE-NATIVE.md</span> et <span className="text-cyan-400">docs/REFERENCES.md</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
