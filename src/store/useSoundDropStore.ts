/**
 * Zustand Global Reactive Store
 * Coordinates AirDrop Radar bubbles, acoustic modem telemetry, and drop sessions.
 */

import { create } from 'zustand';
import {
  PeerBubble,
  ModemMode,
  AcousticTelemetry,
  DropSession,
  SoundDropSettings,
} from '@/types/sound-drop';
import { DropResult } from '@/types/acoustic';

interface SoundDropStoreState {
  // Radar & Bubble Nodes
  peers: PeerBubble[];
  selectedPeerId: string | null;
  addPeer: (peer: PeerBubble) => void;
  updatePeerProgress: (peerId: string, progress: number, status?: PeerBubble['status']) => void;
  removePeer: (peerId: string) => void;

  // Active Acoustic State
  isTransmitting: boolean;
  isListening: boolean;
  activeFrequency: number;
  telemetry: AcousticTelemetry | null;
  currentDropSession: DropSession | null;
  receivedDropModal: DropResult | null;

  // Settings
  settings: SoundDropSettings;

  // Actions
  setIsTransmitting: (transmitting: boolean) => void;
  setIsListening: (listening: boolean) => void;
  setTelemetry: (t: AcousticTelemetry) => void;
  setSelectedPeerId: (id: string | null) => void;
  setReceivedDropModal: (drop: DropResult | null) => void;
  updateSettings: (partial: Partial<SoundDropSettings>) => void;
}

export const useSoundDropStore = create<SoundDropStoreState>((set) => ({
  peers: [],
  selectedPeerId: null,
  isTransmitting: false,
  isListening: false,
  activeFrequency: 0,
  telemetry: null,
  currentDropSession: null,
  receivedDropModal: null,

  settings: {
    modemMode: 'audible',
    loopbackSelfTest: true,
    hapticAudioFeedback: true,
    encryptionEnabled: false,
    encryptionPin: '1234',
    hybridWebRtcFallback: false,
  },

  addPeer: (peer) =>
    set((state) => {
      const exists = state.peers.some((p) => p.id === peer.id);
      if (exists) {
        return {
          peers: state.peers.map((p) => (p.id === peer.id ? { ...p, ...peer, lastSeen: Date.now() } : p)),
        };
      }
      return { peers: [...state.peers, peer] };
    }),

  updatePeerProgress: (peerId, progress, status) =>
    set((state) => ({
      peers: state.peers.map((p) =>
        p.id === peerId
          ? {
              ...p,
              progress,
              status: status || p.status,
            }
          : p
      ),
    })),

  removePeer: (peerId) =>
    set((state) => ({
      peers: state.peers.filter((p) => p.id !== peerId),
    })),

  setIsTransmitting: (isTransmitting) => set({ isTransmitting }),
  setIsListening: (isListening) => set({ isListening }),
  setTelemetry: (telemetry) => set({ telemetry, activeFrequency: telemetry.activeFrequency }),
  setSelectedPeerId: (selectedPeerId) => set({ selectedPeerId }),
  setReceivedDropModal: (receivedDropModal) => set({ receivedDropModal }),
  updateSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...partial } })),
}));
