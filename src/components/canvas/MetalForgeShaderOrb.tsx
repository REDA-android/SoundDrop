'use client';

import React, { useEffect, useRef } from 'react';

export interface MetalForgeShaderOrbProps {
  isActive: boolean;
  snrDb: number;
  dominantFreq?: number;
  mode: string;
}

/**
 * Interactive 3D Metallic / Liquid-Glass Shader Orb (`metalforge.xyz` + `kinetics.colorion.co`)
 * Renders a real-time procedural metallic specular orb whose harmonics and surface ripples
 * are driven by the real microphone / modulator `snrDb` and `dominantFreq` (Zero Mock Data).
 */
export const MetalForgeShaderOrb: React.FC<MetalForgeShaderOrbProps> = ({
  isActive,
  snrDb,
  dominantFreq = 0,
  mode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let phase = 0;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      const energy = isActive ? Math.min(1.5, Math.max(0.15, snrDb / 24)) : 0.08;
      const freqFactor = dominantFreq > 0 ? Math.min(6, dominantFreq / 1200) : 2.2;
      phase += 0.025 + energy * 0.04;

      const baseRadius = 20 + energy * 5;

      // Outer chromatic metallic halo
      const haloGrad = ctx.createRadialGradient(cx, cy, baseRadius * 0.3, cx, cy, baseRadius * 1.45);
      if (mode === 'COMPLETED') {
        haloGrad.addColorStop(0, 'rgba(16, 185, 129, 0.55)');
        haloGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
      } else if (isActive) {
        haloGrad.addColorStop(0, 'rgba(255, 85, 0, 0.55)');
        haloGrad.addColorStop(0.6, 'rgba(56, 189, 248, 0.22)');
        haloGrad.addColorStop(1, 'rgba(10, 10, 12, 0)');
      } else {
        haloGrad.addColorStop(0, 'rgba(161, 161, 170, 0.22)');
        haloGrad.addColorStop(1, 'rgba(10, 10, 12, 0)');
      }
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.45, 0, Math.PI * 2);
      ctx.fill();

      // Deformable Liquid-Metal Sphere Contour
      ctx.save();
      ctx.beginPath();
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        const harmonic =
          Math.sin(theta * Math.round(freqFactor + 2) + phase) * (energy * 2.8) +
          Math.cos(theta * 3 - phase * 1.3) * (energy * 1.6);
        const r = baseRadius + harmonic;
        const x = cx + Math.cos(theta) * r;
        const y = cy + Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // MetalForge Specular Chrome Gradient
      const specX = cx - baseRadius * 0.35 + Math.cos(phase * 0.7) * 4;
      const specY = cy - baseRadius * 0.35 + Math.sin(phase * 0.7) * 4;
      const metalGrad = ctx.createRadialGradient(specX, specY, 2, cx, cy, baseRadius * 1.15);
      metalGrad.addColorStop(0, '#FFFFFF');
      metalGrad.addColorStop(0.28, isActive ? '#FFB088' : '#D4D4D8');
      metalGrad.addColorStop(0.65, isActive ? '#FF5500' : '#3F3F4E');
      metalGrad.addColorStop(1, '#09090D');

      ctx.fillStyle = metalGrad;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.25)';
      ctx.stroke();
      ctx.restore();

      if (isActive) {
        animId = requestAnimationFrame(render);
      }
    };

    render();
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isActive, snrDb, dominantFreq, mode]);

  return (
    <div className="relative flex items-center justify-center">
      <canvas
        ref={canvasRef}
        width={68}
        height={68}
        aria-label="Orbe shader métallique réactif au signal acoustique (MetalForge)"
        className="h-[56px] w-[56px] rounded-2xl bg-[#0A0A0E] border border-white/15"
      />
    </div>
  );
};
