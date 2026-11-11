'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface PageMascotProps {
  mode: 'IDLE' | 'TRANSMITTING' | 'RECEIVING' | 'TRANSFERRING' | 'COMPLETED' | 'ERROR';
  snrDb?: number;
  isConnected?: boolean;
}

/**
 * Interactive Studio Mascot (`nilbuild/page-mascot` architecture)
 * - Real-time 360° cursor angle & 3x3 gaze vector tracking
 * - Interactive poke/click reaction with spring physics (`kinetics.colorion.co`)
 * - Reactive antenna & visor LED driven by real acoustic SNR and WebRTC state
 */
export const PageMascot: React.FC<PageMascotProps> = ({
  mode,
  snrDb = 0,
  isConnected = false,
}) => {
  const containerRef = useRef<HTMLButtonElement | null>(null);
  const [gaze, setGaze] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [isBlinking, setIsBlinking] = useState<boolean>(false);
  const [isPoked, setIsPoked] = useState<boolean>(false);
  const [pokeCount, setPokeCount] = useState<number>(0);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
      const dist = Math.min(1, Math.hypot(e.clientX - cx, e.clientY - cy) / 220);
      setGaze({
        dx: Math.cos(angle) * dist * 3.8,
        dy: Math.sin(angle) * dist * 2.8,
      });
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  useEffect(() => {
    const blinkTimer = window.setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 140);
    }, 4200);
    return () => clearInterval(blinkTimer);
  }, []);

  const handlePoke = () => {
    setIsPoked(true);
    setPokeCount((c) => c + 1);
    setTimeout(() => setIsPoked(false), 520);
  };

  const visorColor =
    mode === 'ERROR'
      ? '#EF4444'
      : mode === 'COMPLETED' || isConnected
      ? '#10B981'
      : mode === 'TRANSMITTING' || mode === 'RECEIVING' || mode === 'TRANSFERRING'
      ? '#FF5500'
      : '#38BDF8';

  const statusBubble =
    isPoked
      ? `Bip ! #${pokeCount}`
      : mode === 'TRANSMITTING'
      ? 'Émission FSK...'
      : mode === 'RECEIVING'
      ? `Écoute (${snrDb.toFixed(1)} dB)`
      : mode === 'TRANSFERRING'
      ? 'Flux P2P actif'
      : mode === 'COMPLETED'
      ? 'SHA-256 OK !'
      : mode === 'ERROR'
      ? 'Alerte lien'
      : 'Prêt à écouter';

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={handlePoke}
      aria-label={`Mascotte interactive SoundDrop (${statusBubble})`}
      title="Cliquez pour interagir avec la mascotte SoundDrop (nilbuild/page-mascot)"
      className="group relative inline-flex items-center gap-2.5 rounded-2xl bg-[#14141C] hover:bg-[#1B1B26] border border-white/15 px-2.5 py-1.5 transition-all duration-200 select-none"
      style={{
        transform: isPoked
          ? 'scale(1.09) rotate(-4deg)'
          : `perspective(300px) rotateX(${(-gaze.dy * 1.8).toFixed(2)}deg) rotateY(${(
              gaze.dx * 1.8
            ).toFixed(2)}deg)`,
      }}
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="overflow-visible"
      >
        {/* Acoustic Antenna */}
        <line
          x1="24"
          y1="4"
          x2={24 + gaze.dx * 0.7}
          y2="11"
          stroke={visorColor}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle
          cx={24 + gaze.dx * 0.7}
          cy="4"
          r={mode === 'IDLE' ? 2.5 : 3.5}
          fill={visorColor}
        />

        {/* Isometric Metallic Head Chassis */}
        <rect
          x="8"
          y="11"
          width="32"
          height="26"
          rx="8"
          fill="#181822"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="1.5"
        />

        {/* Side Acoustic Ear Transducers */}
        <rect x="4" y="19" width="4" height="10" rx="2" fill={visorColor} opacity="0.85" />
        <rect x="40" y="19" width="4" height="10" rx="2" fill={visorColor} opacity="0.85" />

        {/* Recessed OLED Visor Screen */}
        <rect
          x="12"
          y="16"
          width="24"
          height="14"
          rx="4"
          fill="#09090D"
          stroke={visorColor}
          strokeWidth="1"
          strokeOpacity="0.5"
        />

        {/* Dynamic Cursor-Tracking Eyes */}
        {isBlinking || isPoked ? (
          <>
            <path
              d={`M ${16 + gaze.dx} ${23 + gaze.dy} L ${21 + gaze.dx} ${23 + gaze.dy}`}
              stroke={visorColor}
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d={`M ${27 + gaze.dx} ${23 + gaze.dy} L ${32 + gaze.dx} ${23 + gaze.dy}`}
              stroke={visorColor}
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <circle
              cx={18.5 + gaze.dx}
              cy={22.5 + gaze.dy}
              r="2.6"
              fill={visorColor}
            />
            <circle
              cx={29.5 + gaze.dx}
              cy={22.5 + gaze.dy}
              r="2.6"
              fill={visorColor}
            />
            <circle
              cx={17.8 + gaze.dx * 1.1}
              cy={21.6 + gaze.dy * 1.1}
              r="0.9"
              fill="#FFFFFF"
            />
            <circle
              cx={28.8 + gaze.dx * 1.1}
              cy={21.6 + gaze.dy * 1.1}
              r="0.9"
              fill="#FFFFFF"
            />
          </>
        )}

        {/* Mouth / Acoustic Waveform Modulator Bar */}
        <path
          d={
            isPoked || mode === 'COMPLETED'
              ? `M 19 33 Q 24 36.5 29 33`
              : mode === 'TRANSMITTING' || mode === 'RECEIVING'
              ? `M 18 33.5 Q 21 31 24 33.5 T 30 33.5`
              : `M 20 33.5 L 28 33.5`
          }
          stroke={visorColor}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
        />
      </svg>

      <div className="hidden sm:flex flex-col items-start text-left">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#A1A1AA]">
          MASCOTTE DSP
        </span>
        <span className="font-mono text-[11px] font-bold text-[#F4F4F6]">{statusBubble}</span>
      </div>
    </button>
  );
};
