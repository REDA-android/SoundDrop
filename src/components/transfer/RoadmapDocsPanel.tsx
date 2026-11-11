'use client';

import React from 'react';
import { CAPABILITIES } from '@/lib/capabilities';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { BookOpen, FileCode, Shield, Radio, Cpu, Layers } from 'lucide-react';

export const RoadmapDocsPanel: React.FC = () => {
  return (
    <div className="w-full flex flex-col gap-6 font-mono text-xs">
      {/* 1. Capabilities Register Card */}
      <div className="hardware-chassis rounded-2xl p-5 border border-white/15 bg-[#0D0D12] space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-[#F4F4F6] uppercase tracking-wider">
              Registre Officiel des Capacités Web
            </h2>
          </div>
          <span className="text-[10px] text-[#A1A1AA]">Source unique : src/lib/capabilities.ts</span>
        </div>

        <p className="text-[#A1A1AA] text-xs font-sans leading-relaxed">
          Chaque étiquette affichée ci-dessous reflète rigoureusement l&apos;état vérifié du code.
          Les fonctionnalités marquées &laquo; Prévu &raquo; ne prétendent pas fonctionner et sont
          documentées pour les prochaines phases.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.id}
              className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                cap.status === 'real'
                  ? 'bg-emerald-950/20 border-emerald-500/30'
                  : cap.status === 'experimental'
                  ? 'bg-amber-950/20 border-amber-500/30'
                  : 'bg-zinc-900/30 border-white/10 opacity-70'
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-white">{cap.label}</span>
                <span className="text-[10px] text-zinc-400 font-mono">ID: {cap.id}</span>
                {cap.verifiedBy && (
                  <span className="text-[9px] text-emerald-400/80 font-mono">
                    Test: {cap.verifiedBy}
                  </span>
                )}
              </div>
              <StatusBadge capabilityId={cap.id} showExplanation />
            </div>
          ))}
        </div>
      </div>

      {/* 2. Documentation and Native Specifications */}
      <div className="hardware-chassis rounded-2xl p-5 border border-white/15 bg-[#0D0D12] space-y-4">
        <div className="flex items-center gap-2 border-b border-white/10 pb-3">
          <BookOpen className="w-4 h-4 text-[#FF6A1F]" />
          <h2 className="text-sm font-bold text-[#F4F4F6] uppercase tracking-wider">
            Documents de Conception & Références
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl border border-white/10 bg-[#121218] space-y-2">
            <div className="flex items-center gap-2 text-white font-bold text-xs">
              <FileCode className="w-4 h-4 text-orange-400" />
              <span>docs/ARCHITECTURE-NATIVE.md</span>
            </div>
            <p className="text-[11px] text-[#A1A1AA] font-sans">
              Document de conception pour les implémentations natives (Rust, Slint, mobile) :
              gestion audio sans verrou (rtrb), oscillateur vectoriel, physique Rapier2D et SAS.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-white/10 bg-[#121218] space-y-2">
            <div className="flex items-center gap-2 text-white font-bold text-xs">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>docs/REFERENCES.md</span>
            </div>
            <p className="text-[11px] text-[#A1A1AA] font-sans">
              Catalogue complet des 50 dépôts open-source de référence (ggwave, liquid-dsp,
              pocketfft, slint, tweetnacl, reed-solomon-erasure...) avec licences et rôles.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Planned Native Protocols Roadmap */}
      <div className="hardware-chassis rounded-2xl p-5 border border-white/15 bg-[#0D0D12] space-y-4">
        <div className="flex items-center gap-2 border-b border-white/10 pb-3">
          <Radio className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold text-[#F4F4F6] uppercase tracking-wider">
            Feuille de Route des Protocoles P2P
          </h2>
        </div>

        <p className="text-[#A1A1AA] text-xs font-sans leading-relaxed">
          Les protocoles ci-dessous nécessitent des sockets brutes (UDP multicast, frames AWDL 802.11)
          inaccessibles dans une sandbox de navigateur web standard. Ils sont prévus pour les daemons
          natifs compagnons.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            { name: 'OpenDrop / AWDL', desc: 'AirDrop compatible (macOS/iOS direct)', status: 'Prévu (daemon natif)' },
            { name: 'LocalSend v2.1', desc: 'Multicast UDP 53317 réseau local', status: 'Prévu (daemon natif)' },
            { name: 'Syncthing BEP', desc: 'Sync multi-dossiers TLS / TCP', status: 'Prévu (daemon natif)' },
            { name: 'Magic-Wormhole', desc: 'Échange PAKE via serveur de relais', status: 'Prévu (daemon natif)' },
            { name: 'WebTorrent', desc: 'Échange BitTorrent sur WebRTC tracker', status: 'Prévu (expérimental)' },
            { name: 'Reticulum Mesh', desc: 'Réseau maillé radio / audio', status: 'Prévu (daemon natif)' },
            { name: 'Warpinator', desc: 'Protocole Linux Mint LAN sécurisé', status: 'Prévu (daemon natif)' },
            { name: 'PairDrop', desc: 'WebRTC pair-à-pair avec serveur signaling', status: 'Prévu (expérimental)' },
          ].map((proto) => (
            <div key={proto.name} className="p-3 rounded-xl border border-white/10 bg-zinc-900/40 space-y-1">
              <span className="text-xs font-bold text-white block">{proto.name}</span>
              <span className="text-[10px] text-zinc-400 block">{proto.desc}</span>
              <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                {proto.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
