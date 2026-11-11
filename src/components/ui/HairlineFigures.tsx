'use client';

import React, { useState } from 'react';

export interface HairlineFigureProps {
  variant: 'VAULT' | 'CONVEYOR' | 'WAVE_MATRIX' | 'MESH_RADAR';
  active?: boolean;
  label?: string;
  metric?: string;
}

/**
 * Interactive Isometric 1px Line-Art Figures (`lucasmarkes/hairline` + `drawably.dev` + `koboyo.com`)
 * Responds dynamically to pointer coordinates with crisp 1px vector geometry.
 */
export const HairlineFigure: React.FC<HairlineFigureProps> = ({
  variant,
  active = false,
  label,
  metric,
}) => {
  const [pointer, setPointer] = useState<{ x: number; y: number; hovered: boolean }>({
    x: 0.5,
    y: 0.5,
    hovered: false,
  });

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setPointer({ x, y, hovered: true });
  };

  const shiftX = (pointer.x - 0.5) * 8;
  const shiftY = (pointer.y - 0.5) * 6;
  const strokeAccent = active || pointer.hovered ? '#FF6A1F' : 'rgba(244,244,246,0.45)';
  const strokeSecondary = active ? '#10B981' : 'rgba(244,244,246,0.22)';

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setPointer({ x: 0.5, y: 0.5, hovered: false })}
      className="group relative flex items-center gap-3 rounded-xl bg-[#0D0D12] border border-white/15 px-3 py-2 transition-colors hover:border-white/30"
    >
      <svg
        width="44"
        height="40"
        viewBox="0 0 64 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {variant === 'VAULT' && (
          <g>
            {/* Isometric Cube Base */}
            <polygon
              points="32,6 56,18 32,30 8,18"
              stroke={strokeAccent}
              strokeWidth="1.2"
              fill="rgba(255,106,31,0.04)"
            />
            <polyline
              points="8,18 8,38 32,50 56,38 56,18"
              stroke={strokeSecondary}
              strokeWidth="1.2"
            />
            <line x1="32" y1="30" x2="32" y2="50" stroke={strokeSecondary} strokeWidth="1.2" />
            {/* Interactive Floating Inner Core */}
            <polygon
              points={`${32 + shiftX * 0.5},${12 + shiftY * 0.5} ${46 + shiftX * 0.5},${
                19 + shiftY * 0.5
              } ${32 + shiftX * 0.5},${26 + shiftY * 0.5} ${18 + shiftX * 0.5},${
                19 + shiftY * 0.5
              }`}
              stroke="#10B981"
              strokeWidth="1.2"
              strokeDasharray={active ? 'none' : '2 2'}
            />
          </g>
        )}

        {variant === 'CONVEYOR' && (
          <g>
            {/* Isometric Tray Stack */}
            <polygon
              points={`10,${34 + shiftY * 0.3} 32,${44 + shiftY * 0.3} 54,${
                34 + shiftY * 0.3
              } 32,${24 + shiftY * 0.3}`}
              stroke={strokeSecondary}
              strokeWidth="1.2"
            />
            <polygon
              points={`10,${25 - shiftY * 0.3} 32,${35 - shiftY * 0.3} 54,${
                25 - shiftY * 0.3
              } 32,${15 - shiftY * 0.3}`}
              stroke={strokeAccent}
              strokeWidth="1.2"
              fill="rgba(255,106,31,0.05)"
            />
            <polygon
              points={`14,${16 + shiftX * 0.4} 32,${25 + shiftX * 0.4} 50,${
                16 + shiftX * 0.4
              } 32,${7 + shiftX * 0.4}`}
              stroke="#38BDF8"
              strokeWidth="1.2"
            />
          </g>
        )}

        {variant === 'WAVE_MATRIX' && (
          <g>
            {[0, 1, 2, 3, 4, 5, 6].map((idx) => {
              const x = 8 + idx * 8;
              const h =
                10 +
                Math.abs(Math.sin(idx * 0.9 + pointer.x * 4)) * (active ? 26 : 16);
              return (
                <line
                  key={idx}
                  x1={x}
                  y1={28 - h / 2}
                  x2={x}
                  y2={28 + h / 2}
                  stroke={idx % 2 === 0 ? strokeAccent : '#38BDF8'}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              );
            })}
            <line
              x1="4"
              y1="28"
              x2="60"
              y2="28"
              stroke={strokeSecondary}
              strokeWidth="0.9"
              strokeDasharray="2 2"
            />
          </g>
        )}

        {variant === 'MESH_RADAR' && (
          <g>
            <ellipse
              cx="32"
              cy="28"
              rx="24"
              ry="13"
              stroke={strokeSecondary}
              strokeWidth="1.1"
            />
            <ellipse
              cx="32"
              cy="28"
              rx="14"
              ry="7.5"
              stroke={strokeAccent}
              strokeWidth="1.1"
              strokeDasharray="3 2"
            />
            <line
              x1="32"
              y1="28"
              x2={32 + Math.cos(pointer.x * Math.PI * 2) * 22}
              y2={28 + Math.sin(pointer.x * Math.PI * 2) * 11}
              stroke="#10B981"
              strokeWidth="1.4"
            />
            <circle
              cx={32 + shiftX * 1.4}
              cy={28 + shiftY * 1.1}
              r="2.5"
              fill="#FF6A1F"
            />
          </g>
        )}
      </svg>

      {(label || metric) && (
        <div className="flex flex-col min-w-0">
          {label && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#A1A1AA] truncate">
              {label}
            </span>
          )}
          {metric && (
            <span className="font-mono text-xs font-bold text-[#F4F4F6] truncate">{metric}</span>
          )}
        </div>
      )}
    </div>
  );
};
