export type ProfileId =
  | 'audible-normal'
  | 'audible-fast'
  | 'audible-fastest'
  | 'ultrasound-normal'
  | 'ultrasound-fast'
  | 'ultrasound-fastest';

export interface AcousticModem {
  /** Taille utile maximale d’un message, confirmée par le moteur. */
  readonly maxPayloadBytes: number;
  /** Durée (s) d’un message de `bytes` octets, calculée sur l’audio réellement généré. */
  encode(payload: Uint8Array, profile: ProfileId, volume: number): Float32Array;
  /** Alimente le décodeur ; renvoie les messages décodés pendant cet appel. */
  feed(samples: Float32Array): Uint8Array[];
  /** Libère les ressources du décodeur. */
  dispose(): void;
}
