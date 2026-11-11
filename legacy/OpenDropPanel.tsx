'use client';

import React, { useState, useEffect } from 'react';
import {
  OpenDropDevice,
  OpenDropTransferProgress,
  OpenDropAskRequest,
} from '@/lib/opendrop/opendrop-types';
import { OpenDropClient } from '@/lib/opendrop/OpenDropClient';
import { formatBytes } from '@/lib/utils/formatters';
import { Wifi, Send, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

interface OpenDropPanelProps {
  selectedFile: File | null;
  onFileSelectRequested?: () => void;
}

export const OpenDropPanel: React.FC<OpenDropPanelProps> = ({
  selectedFile,
  onFileSelectRequested,
}) => {
  const [client, setClient] = useState<OpenDropClient | null>(null);
  const [localDevice, setLocalDevice] = useState<OpenDropDevice | null>(null);
  const [nearbyNodes, setNearbyNodes] = useState<OpenDropDevice[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [transferProgress, setTransferProgress] = useState<OpenDropTransferProgress | null>(null);
  const [statusText, setStatusText] = useState('DÉCOUVERTE ACTIVE');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Incoming AirDrop Request
  const [incomingRequest, setIncomingRequest] = useState<OpenDropAskRequest | null>(null);
  const [incomingAcceptFn, setIncomingAcceptFn] = useState<(() => Promise<void>) | null>(null);
  const [incomingDeclineFn, setIncomingDeclineFn] = useState<(() => void) | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    const odc = new OpenDropClient();
    setClient(odc);
    setLocalDevice(odc.getLocalDevice());

    odc.startDiscovery(
      (nodes) => {
        setNearbyNodes(nodes);
      },
      (request, accept, decline) => {
        setIncomingRequest(request);
        setIncomingAcceptFn(() => accept);
        setIncomingDeclineFn(() => decline);
      }
    );

    return () => {
      odc.stopDiscovery();
    };
  }, []);

  const handleSendToNode = async (node: OpenDropDevice) => {
    if (!client || !selectedFile || isSending) return;

    try {
      setIsSending(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      setStatusText(`AIRDROP -> ${node.computerName.toUpperCase()}`);

      await client.sendFile(node, selectedFile, (prog) => {
        setTransferProgress(prog);
      });

      setSuccessMsg(`Fichier "${selectedFile.name}" envoyé avec succès à ${node.computerName}.`);
      setStatusText('TRANSFERT TERMINÉ');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatusText('ERREUR TRANSFERT');
    } finally {
      setIsSending(false);
    }
  };

  const handleAcceptIncoming = async () => {
    if (!incomingAcceptFn) return;
    try {
      setIsAccepting(true);
      await incomingAcceptFn();
      setSuccessMsg('Transfert AirDrop / OpenDrop accepté et téléchargé.');
      setIncomingRequest(null);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDeclineIncoming = () => {
    if (incomingDeclineFn) {
      incomingDeclineFn();
    }
    setIncomingRequest(null);
  };

  return (
    <div className="space-y-3.5 font-mono text-xs">
      {/* Node Identity Card */}
      <div className="p-4 bg-[#121217] border border-white/15 rounded-xl">
        <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
          <span className="text-[#A1A1AA] font-semibold">NŒUD OPENDROP / AIRDROP v2</span>
          <span className="flex items-center gap-1.5 text-[#34D399] font-semibold">
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
            _airdrop._tcp
          </span>
        </div>
        <div className="pt-2.5 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-[#F4F4F6]">
              {localDevice?.computerName || 'SoundDrop Node'}
            </div>
            <div className="text-[11px] text-[#A1A1AA] mt-0.5">
              Endpoints actifs : <code>/Discover</code> • <code>/Ask</code> • <code>/Upload</code>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void client?.fetchNodes()}
            aria-label="Rafraîchir la liste des appareils OpenDrop"
            className="inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1C1C24] border border-white/15 text-[#E4E4E7] hover:border-white/30 transition-colors"
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 text-[#FF6A1F]" />
            <span>Scanner</span>
          </button>
        </div>
      </div>

      {/* Incoming AirDrop Transfer Alert */}
      {incomingRequest && (
        <div
          role="alert"
          className="p-4 bg-[#141C1A] border-2 border-[#10B981] rounded-xl space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#34D399] uppercase tracking-wider flex items-center gap-2">
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#10B981]" />
              DEMANDE AIRDROP ENTRANTE
            </span>
            <span className="text-[11px] text-[#A1A1AA]">SEEMOO / OPENDROP</span>
          </div>

          <div className="text-xs text-[#F4F4F6]">
            <strong className="text-[#FF7A33]">{incomingRequest.senderComputerName}</strong>{' '}
            souhaite vous envoyer :
          </div>

          <div className="p-3 bg-[#0A0C10] border border-white/15 rounded-lg flex justify-between items-center">
            <span className="text-[#F4F4F6] font-semibold truncate max-w-[220px]">
              {incomingRequest.files[0]?.name || 'Fichier'}
            </span>
            <span className="text-[#A1A1AA]">
              {formatBytes(incomingRequest.totalBytes || 0)}
            </span>
          </div>

          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleDeclineIncoming}
              className="flex-1 min-h-[40px] py-2 bg-[#1F2430] hover:bg-[#2B3140] text-xs text-[#E4E4E7] font-bold rounded-lg uppercase transition-colors"
            >
              Refuser
            </button>
            <button
              type="button"
              disabled={isAccepting}
              onClick={() => void handleAcceptIncoming()}
              className="flex-1 min-h-[40px] py-2 bg-[#10B981] hover:bg-[#059669] text-xs text-black font-bold rounded-lg uppercase transition-colors"
            >
              {isAccepting ? 'Téléchargement...' : 'Accepter & Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* Transfer Progress if Sending */}
      {isSending && transferProgress && (
        <div className="p-3.5 bg-[#0C0C10] border border-[#FF5500]/50 rounded-xl space-y-2">
          <div className="flex justify-between text-xs text-[#FF7A33] font-semibold">
            <span>{statusText}</span>
            <span>{transferProgress.percentage}%</span>
          </div>
          <div className="w-full h-2 bg-[#1C1C24] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#FF5500] transition-all duration-150"
              style={{ width: `${transferProgress.percentage}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-[#A1A1AA]">
            <span>
              {formatBytes(transferProgress.bytesTransferred)} /{' '}
              {formatBytes(transferProgress.totalBytes)}
            </span>
            <span>{formatBytes(transferProgress.speedBytesPerSec)}/s</span>
          </div>
        </div>
      )}

      {/* Notifications */}
      {successMsg && (
        <div
          role="status"
          className="p-3 text-xs bg-[#10B981]/15 border border-[#10B981]/40 text-[#34D399] rounded-xl flex items-center gap-2"
        >
          <CheckCircle2 aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          className="p-3 text-xs bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#FCA5A5] rounded-xl flex items-center gap-2"
        >
          <AlertCircle aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Discovered OpenDrop & AirDrop Peers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[#A1A1AA] px-1">
          <span className="font-semibold">
            PAIRS OPENDROP DÉTECTÉS ({nearbyNodes.length})
          </span>
          <span>BroadcastChannel + API Edge</span>
        </div>

        {nearbyNodes.length === 0 ? (
          <div className="p-5 bg-[#0C0C10] border border-dashed border-white/15 rounded-xl text-center space-y-2">
            <Wifi aria-hidden="true" className="h-5 w-5 text-[#FF6A1F] mx-auto animate-pulse" />
            <div className="text-xs font-medium text-[#E4E4E7]">
              En attente d&apos;autres appareils OpenDrop / AirDrop...
            </div>
            <div className="text-[11px] text-[#A1A1AA] max-w-sm mx-auto">
              Ouvrez SoundDrop dans un second onglet ou sur un autre appareil, ou utilisez{' '}
              <code>opendrop send</code> vers cette station.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {nearbyNodes.map((node) => (
              <div
                key={node.id}
                className="p-3.5 bg-[#121217] border border-white/15 hover:border-[#FF5500]/50 transition-colors rounded-xl flex items-center justify-between gap-3"
              >
                <div className="space-y-0.5 overflow-hidden">
                  <div className="text-xs font-bold text-[#F4F4F6] flex items-center gap-2 truncate">
                    <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#10B981]" />
                    <span>{node.computerName}</span>
                  </div>
                  <div className="text-[11px] text-[#A1A1AA]">
                    {node.modelName || 'AirDrop-PWA'} • AirDrop 2.0
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!selectedFile || isSending}
                  onClick={() => void handleSendToNode(node)}
                  className={`min-h-[38px] px-3.5 py-2 text-xs font-bold rounded-xl uppercase inline-flex items-center gap-1.5 transition-all ${
                    selectedFile && !isSending
                      ? 'tactile-btn-primary'
                      : 'bg-[#1C1C24] text-[#A1A1AA] opacity-50 cursor-not-allowed border border-white/10'
                  }`}
                >
                  <Send aria-hidden="true" className="h-3.5 w-3.5" />
                  <span>{isSending ? 'Envoi...' : 'Envoyer'}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!selectedFile && onFileSelectRequested && (
        <div className="p-3 bg-[#121217] border border-white/10 rounded-xl flex items-center justify-between gap-2 text-xs">
          <span className="text-[#A1A1AA]">
            Sélectionnez d&apos;abord un fichier ou dossier dans la colonne de gauche.
          </span>
        </div>
      )}
    </div>
  );
};
