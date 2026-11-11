'use client';

import React, { useEffect, useRef } from 'react';

interface MeshParticleCanvasProps {
  snrDb?: number;
  dominantFreq?: number;
  isActive?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseRadius: number;
  color: string;
}

export const MeshParticleCanvas: React.FC<MeshParticleCanvasProps> = ({
  snrDb = 0,
  dominantFreq = 0,
  isActive = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };

    window.addEventListener('resize', handleResize);

    const particleCount = Math.min(36, Math.max(20, Math.floor((width * height) / 28000)));
    const particles: Particle[] = [];

    const colors = ['#FF5500', '#00E599', '#8C96A8', '#FFFFFF'];

    for (let i = 0; i < particleCount; i++) {
      const baseRadius = 1.2 + Math.random() * 1.4;
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.65,
        vy: (Math.random() - 0.5) * 0.65,
        radius: baseRadius,
        baseRadius,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const audioEnergy = isActive ? Math.min(2.2, Math.max(1.0, 1.0 + snrDb / 15)) : 1.0;
      const connectionDist = (width < 640 ? 75 : 105) * (isActive ? 1.2 : 1.0);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx * audioEnergy;
        p.y += p.vy * audioEnergy;

        if (p.x < 0) {
          p.x = 0;
          p.vx *= -1;
        } else if (p.x > width) {
          p.x = width;
          p.vx *= -1;
        }

        if (p.y < 0) {
          p.y = 0;
          p.vy *= -1;
        } else if (p.y > height) {
          p.y = height;
          p.vy *= -1;
        }

        const currentRadius = p.baseRadius * (isActive ? 1.15 + snrDb / 35 : 1.0);
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const p1 = particles[i];
          const p2 = particles[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < connectionDist) {
            const alpha = (1 - dist / connectionDist) * (isActive ? 0.42 : 0.16);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(140, 150, 168, ${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      if (isActive) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [isActive, snrDb, dominantFreq]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 w-full h-full opacity-55"
    />
  );
};
