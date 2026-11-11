/**
 * Procedural Tactile AirDrop Sound Effects Synthesizer
 * Zero MP3 bloat: Synthesizes glassy chimes, bubble pops, radar pings, and whooshes
 * directly via the Web Audio API.
 * Automatically mutes when acoustic data transmission or reception is active.
 */

class AirDropAudioSynth {
  private audioCtx: AudioContext | null = null;
  private isModemActive = false;
  private isMuted = false;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  public setModemActive(active: boolean): void {
    this.isModemActive = active;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  /**
   * Radar Ping: Soft resonant harmonic blip when radar scanning starts
   */
  public playRadarPing(): void {
    if (this.isModemActive || this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(880, t); // A5
    osc.frequency.exponentialRampToValueAtTime(1760, t + 0.15); // A6

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.4);
  }

  /**
   * Bubble Pop: Warm organic water-drop pop when a peer bubble appears
   */
  public playBubblePop(): void {
    if (this.isModemActive || this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(450, t);
    osc.frequency.exponentialRampToValueAtTime(1100, t + 0.06);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.2);
  }

  /**
   * Whoosh Send: Rising airy harmonic sweep when dropping a file onto a bubble
   */
  public playDropWhoosh(): void {
    if (this.isModemActive || this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(780, t + 0.25);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.35);
  }

  /**
   * Success Chord: Apple AirDrop-inspired glassy major 9th chime (C-E-G-B-D)
   */
  public playSuccessChime(): void {
    if (this.isModemActive || this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    // Frequencies for Cmaj9: C5 (523.25), E5 (659.25), G5 (783.99), B5 (987.77), D6 (1174.66)
    const notes = [523.25, 659.25, 783.99, 987.77, 1174.66];
    const t = ctx.currentTime;

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + i * 0.04);

      const noteTime = t + i * 0.04;
      gain.gain.setValueAtTime(0.001, noteTime);
      gain.gain.linearRampToValueAtTime(0.06, noteTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.85);
    });
  }
}

export const airdropSynth = new AirDropAudioSynth();
