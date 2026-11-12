'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Clipboard,
  Copy,
  Check,
  Radio,
  Mic,
  Send,
  Volume2,
  Trash2,
  Sparkles,
  ShieldCheck,
  Share2,
} from 'lucide-react';
import { MorphIcon } from '@/components/ui/MorphIcon';
import { DrawablySketchBadge } from '@/components/ui/DrawablySketchBadge';
import { createGgwaveModem } from '@/lib/modem/ggwave-engine';
import { playSamples } from '@/lib/audio/playback';
import { startCapture, CaptureHandle } from '@/lib/audio/capture';

export interface ClipboardItem {
  id: string;
  content: string;
  type: 'text' | 'url' | 'secret';
  timestamp: number;
  source: 'acoustic' | 'p2p' | 'local';
}

interface ClipboardSyncProps {
  onEmitP2PClipboard?: (text: string) => boolean;
  incomingClipboards?: ClipboardItem[];
}

export const ClipboardSync: React.FC<ClipboardSyncProps> = ({
  onEmitP2PClipboard,
  incomingClipboards = [],
}) => {
  const [inputText, setInputText] = useState('');
  const [history, setHistory] = useState<ClipboardItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [acousticStatus, setAcousticStatus] = useState<string>('En attente');

  const captureHandleRef = useRef<CaptureHandle | null>(null);

  // Sync external incoming clipboards
  useEffect(() => {
    if (incomingClipboards.length > 0) {
      setHistory((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const newItems = incomingClipboards.filter((item) => !ids.has(item.id));
        return [...newItems, ...prev];
      });
    }
  }, [incomingClipboards]);

  // Clean up mic on unmount
  useEffect(() => {
    return () => {
      if (captureHandleRef.current) {
        captureHandleRef.current.stop();
      }
    };
  }, []);

  const detectType = (val: string): 'text' | 'url' | 'secret' => {
    if (/^https?:\/\//i.test(val.trim())) return 'url';
    if (/^(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|sk_live_[a-zA-Z0-9]+)/.test(val.trim())) {
      return 'secret';
    }
    return 'text';
  };

  // Broadcast text via acoustic sound
  const handleBroadcastAcoustic = async () => {
    if (!inputText.trim() || isBroadcasting) return;

    try {
      setIsBroadcasting(true);
      setAcousticStatus('Émission acoustique...');

      const textBytes = new TextEncoder().encode(`CLIP:${inputText.trim()}`);
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtxClass({ sampleRate: 48000 });
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const modem = await createGgwaveModem(48000);
      const audioSamples = modem.encode(textBytes, 'audible-fast', 0.85);

      await playSamples(audioCtx, audioSamples, { volume: 0.85 });

      modem.dispose();
      await audioCtx.close();

      // Add to local history
      const newItem: ClipboardItem = {
        id: `clip-${Date.now()}`,
        content: inputText.trim(),
        type: detectType(inputText),
        timestamp: Date.now(),
        source: 'local',
      };
      setHistory((prev) => [newItem, ...prev]);

      // Also try P2P if available
      if (onEmitP2PClipboard) {
        onEmitP2PClipboard(inputText.trim());
      }

      setInputText('');
      setAcousticStatus('Diffusé avec succès');
      setTimeout(() => setAcousticStatus('En attente'), 2500);
    } catch (err) {
      setAcousticStatus(`Erreur émission : ${(err as Error).message}`);
    } finally {
      setIsBroadcasting(false);
    }
  };

  // Toggle live acoustic microphone listening
  const toggleListening = async () => {
    if (isListening) {
      if (captureHandleRef.current) {
        captureHandleRef.current.stop();
        captureHandleRef.current = null;
      }
      setIsListening(false);
      setAcousticStatus('Écoute arrêtée');
      return;
    }

    try {
      setIsListening(true);
      setAcousticStatus('Microphone actif : écoute des tonalités...');

      const modem = await createGgwaveModem(48000);

      const handle = await startCapture((samples) => {
        const decodedPackets = modem.feed(samples);
        for (const pkt of decodedPackets) {
          const rawText = new TextDecoder().decode(pkt);
          if (rawText.startsWith('CLIP:')) {
            const payload = rawText.slice(5);
            const newItem: ClipboardItem = {
              id: `clip-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              content: payload,
              type: detectType(payload),
              timestamp: Date.now(),
              source: 'acoustic',
            };
            setHistory((prev) => {
              if (prev.some((p) => p.content === payload)) return prev;
              return [newItem, ...prev];
            });
            setAcousticStatus(`Reçu par le son : ${payload.slice(0, 20)}...`);
          }
        }
      });

      captureHandleRef.current = handle;
    } catch (err) {
      setIsListening(false);
      setAcousticStatus(`Micro non disponible : ${(err as Error).message}`);
    }
  };

  const copyToClipboard = async (item: ClipboardItem) => {
    await navigator.clipboard.writeText(item.content);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="w-full glass-panel rounded-2xl p-5 sm:p-6 flex flex-col gap-5 text-[#E4E4E7]">
      {/* En-tête avec MorphIcon & Drawably */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-sky-500/10 to-transparent border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-500/10">
            <Clipboard className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold font-mono tracking-tight text-white">
                Presse-Papier Synchronisé
              </h3>
              <DrawablySketchBadge text="AIR-GAP" accent="sky" />
            </div>
            <p className="text-xs text-neutral-400">
              Synchronisation instantanée de textes, URLs et clés secrètes par son & LAN
            </p>
          </div>
        </div>

        {/* Bouton bascule écoute micro */}
        <button
          type="button"
          onClick={() => void toggleListening()}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-mono text-xs font-semibold border transition-all ${
            isListening
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)] animate-pulse'
              : 'bg-white/[0.04] border-white/10 text-neutral-400 hover:text-white hover:bg-white/[0.08]'
          }`}
        >
          <Mic className={`w-3.5 h-3.5 ${isListening ? 'text-emerald-400' : ''}`} />
          <span>{isListening ? 'Écoute Micro Active' : 'Activer Écoute Micro'}</span>
        </button>
      </div>

      {/* Zone de saisie et diffusion */}
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <textarea
            rows={3}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Collez ou tapez un texte, une URL ou une clé secrète à synchroniser..."
            className="w-full bg-[#08090F] border border-white/[0.08] focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 rounded-xl p-3.5 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none transition-all shadow-inner resize-none"
          />
          <div className="absolute right-3 bottom-3 flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text) setInputText(text);
                } catch {}
              }}
              className="text-[10px] font-mono text-neutral-400 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] px-2 py-1 rounded-md border border-white/10 transition-colors"
            >
              Coller depuis l'OS
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-500">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span>{acousticStatus}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleBroadcastAcoustic()}
              disabled={!inputText.trim() || isBroadcasting}
              className="flex items-center gap-2 py-2.5 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black disabled:opacity-40 disabled:pointer-events-none transition-all shadow-[0_0_20px_rgba(6,182,212,0.25)] active:scale-[0.99]"
            >
              {isBroadcasting ? (
                <>
                  <Volume2 className="w-3.5 h-3.5 animate-bounce" />
                  <span>Diffusion...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Diffuser par le Son</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Historique du presse-papier */}
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center justify-between text-xs font-mono text-neutral-400 border-b border-white/[0.06] pb-2">
          <span>Historique Récent ({history.length})</span>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Effacer</span>
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="text-center py-8 text-neutral-500 text-xs font-mono flex flex-col items-center gap-2">
            <Sparkles className="w-6 h-6 text-neutral-600" />
            <p>Aucun élément synchronisé pour le moment.</p>
            <p className="text-[10px] text-neutral-600">
              Tapez un message ci-dessus ou activez l'écoute pour recevoir par le son.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-3 bg-[#08090F] border border-white/[0.06] rounded-xl text-xs font-mono group hover:border-cyan-500/30 transition-all shadow-sm"
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold border ${
                        item.type === 'url'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          : item.type === 'secret'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-white/[0.04] text-neutral-400 border-white/[0.06]'
                      }`}
                    >
                      {item.type}
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-[9px] text-neutral-600">
                      via {item.source === 'acoustic' ? 'son 🔊' : item.source === 'p2p' ? 'LAN 🌐' : 'local'}
                    </span>
                  </div>
                  <p className="text-neutral-200 truncate font-mono text-xs select-all">
                    {item.content}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void copyToClipboard(item)}
                  className={`p-2 rounded-lg border transition-all ${
                    copiedId === item.id
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-white/[0.04] text-neutral-400 hover:text-white hover:bg-white/[0.08] border-white/[0.08]'
                  }`}
                  title="Copier dans le presse-papier"
                >
                  {copiedId === item.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
