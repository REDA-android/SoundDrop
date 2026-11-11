export type Status = 'real' | 'experimental' | 'planned';

export interface Capability {
  id: string;
  label: string;
  status: Status;
  /** Chemin du test automatisé qui prouve la fonction (obligatoire si status = 'real'). */
  verifiedBy?: string;
}

export const CAPABILITIES: Capability[] = [
  { id: 'acoustic-audible', label: 'Transfert sonore audible', status: 'real', verifiedBy: 'src/lib/modem/modem.test.ts' },
  { id: 'acoustic-ultrasonic', label: 'Transfert ultrasonique', status: 'experimental' },
  { id: 'text-transfer', label: 'Envoi de texte / URL', status: 'real', verifiedBy: 'src/lib/protocol/protocol.test.ts' },
  { id: 'file-transfer', label: 'Envoi de petits fichiers', status: 'real', verifiedBy: 'src/lib/protocol/protocol.test.ts' },
  { id: 'encryption', label: 'Chiffrement de bout en bout', status: 'real', verifiedBy: 'src/lib/crypto/crypto.test.ts' },
  { id: 'sas-pairing', label: 'Vérification par code court (SAS)', status: 'real', verifiedBy: 'src/lib/crypto/crypto.test.ts' },
  { id: 'webrtc-lan', label: 'WebRTC réseau local', status: 'experimental' },
  { id: 'pwa-offline', label: 'Utilisation hors ligne', status: 'real', verifiedBy: 'src/lib/pwa/pwa.test.ts' },
  { id: 'satellite-orbital-relay', label: 'Relais Satellite Orbital (SOR)', status: 'experimental', verifiedBy: 'src/lib/satellite/satellite.test.ts' },
];

export const byId = (id: string): Capability | undefined => CAPABILITIES.find((c) => c.id === id);
