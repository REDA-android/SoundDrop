'use client';

import React from 'react';
import { SymbolMeter } from '../SymbolMeter';
import { AcousticTelemetry } from '@/types/sound-drop';
import { ModemConfig } from '@/types/acoustic';

interface GoertzelSymbolBarsProps {
  telemetry: AcousticTelemetry | null;
  config: ModemConfig;
}

export const GoertzelSymbolBars: React.FC<GoertzelSymbolBarsProps> = ({
  telemetry,
  config,
}) => {
  // Adapt AcousticTelemetry to Telemetry interface
  const adapted = telemetry
    ? {
        snrDb: telemetry.snrDb,
        noiseFloor: telemetry.noiseFloor,
        peakEnergy: telemetry.peakEnergy,
        detectedSymbol: telemetry.detectedSymbol,
        goertzelEnergies: telemetry.goertzelEnergies,
        confidence: telemetry.confidence,
        activeFrequency: telemetry.activeFrequency,
        lockedState: (telemetry.state === 'RECEIVING' ? 'DECODING_SYMBOLS' : telemetry.state === 'LOCKED' ? 'LOCKED_ON_SIGNAL' : 'LISTENING_FOR_CHIRP') as any,
        framesDecoded: telemetry.framesDecoded,
        crcErrors: telemetry.crcErrors,
        fecCorrections: telemetry.fecCorrections,
      }
    : null;

  return <SymbolMeter telemetry={adapted} config={config} />;
};
