// Sound: a tiny Web Audio engine sized for an ambient, mostly-felt soundtrack.
// One oscillator + filter drone for the globe, short-envelope thumps for
// transitions and impacts. No external assets. Muted by default and
// initialised lazily on the first user gesture, since browsers suspend audio
// contexts until user interaction.
//
// Public API is a small singleton mirroring SoundEngine. Callers do not
// construct the engine themselves, they call the wrapper functions.

import { themeForEra } from '../theme/era';

class SoundEngine {
  // ctx is created lazily so the page doesn't pay the cost (or trip the
  // browser's autoplay block) when sound is disabled.
  private ctx: AudioContext | null = null;
  // master gain governs the overall mix and is muted by default.
  private master: GainNode | null = null;
  // ambient is the persistent drone. Nullable so we can stop/restart it.
  private ambient: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private enabled = false;
  private currentEra = '';

  // enabled reflects whether the user has opted into sound. Until true, every
  // play call is a no-op.
  isEnabled(): boolean {
    return this.enabled;
  }

  // enable initialises the context on the next user gesture (this call should
  // already be inside one) and ramps the master gain up. Idempotent.
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.ensureContext();
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.55, now + 0.4);
    this.startAmbient();
  }

  // disable fades the master gain to zero and stops the ambient drone.
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.0, now + 0.3);
    setTimeout(() => this.stopAmbient(), 350);
  }

  // setEra colors the ambient drone for a given era: warm low-pass for
  // antiquity, cooler highs for modern. The crossfade is short but audible.
  setEra(era: string): void {
    this.currentEra = era;
    if (!this.enabled || !this.ambient || !this.ctx) return;
    const theme = themeForEra(era);
    const cutoff = eraCutoff(era);
    const detune = eraDetune(era);
    const now = this.ctx.currentTime;
    this.ambient.filter.frequency.cancelScheduledValues(now);
    this.ambient.filter.frequency.setValueAtTime(this.ambient.filter.frequency.value, now);
    this.ambient.filter.frequency.linearRampToValueAtTime(cutoff, now + 1.6);
    this.ambient.osc.detune.cancelScheduledValues(now);
    this.ambient.osc.detune.setValueAtTime(this.ambient.osc.detune.value, now);
    this.ambient.osc.detune.linearRampToValueAtTime(detune, now + 1.6);
    void theme;
  }

  // phaseAdvance is a soft low thump played at the start of each replay phase.
  // It reads as "page turn" without being intrusive.
  phaseAdvance(): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.45);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.75);
  }

  // select is a barely-there UI tick for selection events. Higher and shorter
  // than phaseAdvance so the two never get confused.
  select(): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.16);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  // impact accompanies an arrow's arrival in the replay. A short low boom
  // with a clean envelope. Reads as "force arrived" rather than as an alarm.
  impact(): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.35);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  // ensureContext lazily constructs the AudioContext and master gain.
  private ensureContext(): void {
    if (this.ctx) return;
    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const w = window as WindowWithWebkit;
    const Ctor: typeof AudioContext | undefined = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
  }

  // startAmbient lays down the persistent drone. Triangle wave through a
  // gentle low-pass filter, with a faint detuned partial via the filter Q.
  private startAmbient(): void {
    if (!this.ctx || !this.master) return;
    if (this.ambient) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 64;
    osc.detune.value = eraDetune(this.currentEra);
    filter.type = 'lowpass';
    filter.frequency.value = eraCutoff(this.currentEra);
    filter.Q.value = 0.8;
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    const now = ctx.currentTime;
    gain.gain.linearRampToValueAtTime(0.14, now + 1.4);
    this.ambient = { osc, gain, filter };
  }

  // stopAmbient fades the drone out and disposes the oscillator.
  private stopAmbient(): void {
    if (!this.ambient || !this.ctx) return;
    const { osc, gain } = this.ambient;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.4);
    try {
      osc.stop(now + 0.5);
    } catch {
      // already stopped
    }
    this.ambient = null;
  }
}

// eraCutoff returns the ambient low-pass cutoff frequency for an era. Ancient
// is darkest (warm and felt), modern is brightest (open and airy).
function eraCutoff(era: string): number {
  switch (era) {
    case 'ancient': return 260;
    case 'medieval': return 320;
    case 'early-modern': return 420;
    case 'napoleonic': return 540;
    case 'industrial': return 640;
    case 'world-war-1': return 700;
    case 'world-war-2': return 760;
    case 'modern': return 880;
    default: return 520;
  }
}

// eraDetune nudges the drone's pitch a few cents per era so the underlying
// chord shifts as history advances. Listeners feel the change more than they
// notice it.
function eraDetune(era: string): number {
  switch (era) {
    case 'ancient': return -18;
    case 'medieval': return -10;
    case 'early-modern': return -4;
    case 'napoleonic': return 0;
    case 'industrial': return 4;
    case 'world-war-1': return 8;
    case 'world-war-2': return 10;
    case 'modern': return 14;
    default: return 0;
  }
}

const engine = new SoundEngine();

export function soundEnabled(): boolean { return engine.isEnabled(); }
export function enableSound(): void { engine.enable(); }
export function disableSound(): void { engine.disable(); }
export function setSoundEra(era: string): void { engine.setEra(era); }
export function playPhaseAdvance(): void { engine.phaseAdvance(); }
export function playSelect(): void { engine.select(); }
export function playImpact(): void { engine.impact(); }
