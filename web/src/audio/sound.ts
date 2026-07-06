// Sound: a tiny Web Audio engine sized for an ambient, mostly-felt soundtrack.
// A single oscillator drone was the first cut and it read as a flat hum.
// This version is closer to a generative ambient pad: a four-voice chord per
// era (root, fifth, low octave, and a coloured upper tone), a slow LFO that
// breathes the filter cutoff so the pad never sits still, and a second LFO
// that modulates one voice's gain so the chord shifts emphasis over time.
// Short-envelope events (phase advance, select, impact) for transitions.
// No external assets. Muted by default and initialised lazily on the first
// user gesture, since browsers suspend audio contexts until user interaction.
//
// Public API is a small singleton mirroring SoundEngine. Callers do not
// construct the engine themselves, they call the wrapper functions.

// VoiceConfig describes one oscillator in the ambient pad. Each era picks a
// set of these and the chord they form together is what the listener hears.
interface VoiceConfig {
  // freq is the base frequency in hertz.
  freq: number;
  // type is the oscillator waveform.
  type: OscillatorType;
  // detune is a constant pitch nudge in cents.
  detune: number;
  // pan is the stereo placement [-1, 1].
  pan: number;
  // gain is the per-voice mix level (0 to 1, summed across voices).
  gain: number;
}

// Voice is a running instance of a VoiceConfig.
interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

class SoundEngine {
  // ctx is created lazily so the page doesn't pay the cost (or trip the
  // browser's autoplay block) when sound is disabled.
  private ctx: AudioContext | null = null;
  // master gain governs the overall mix and is muted by default.
  private master: GainNode | null = null;
  // filter is the shared low-pass that shapes the pad. Modulated by lfo.
  private filter: BiquadFilterNode | null = null;
  // lfo is a slow oscillator that breathes the filter cutoff. Kept separate
  // from per-voice modulation so the chord moves as a single body.
  private lfo: { osc: OscillatorNode; gain: GainNode } | null = null;
  // shimmer modulates one voice's gain so the chord internal balance shifts.
  private shimmer: { osc: OscillatorNode; gain: GainNode } | null = null;
  // voices holds the running oscillators of the active chord.
  private voices: Voice[] = [];
  private enabled = false;
  private currentEra = '';

  // isEnabled reflects whether the user has opted into sound. Until true,
  // every play call is a no-op.
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
    this.master.gain.linearRampToValueAtTime(0.5, now + 0.6);
    this.startAmbient();
  }

  // disable fades the master gain to zero and stops the ambient pad.
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.0, now + 0.5);
    setTimeout(() => this.stopAmbient(), 550);
  }

  // setEra crossfades the ambient chord to one tuned for the named era. The
  // pad keeps playing through the change; voices are stopped one by one and
  // replaced so the listener feels a slow tonal shift, not a cut.
  setEra(era: string): void {
    if (this.currentEra === era) return;
    this.currentEra = era;
    if (!this.enabled || !this.ctx || !this.master || !this.filter) return;
    const cfgs = eraVoices(era);
    const now = this.ctx.currentTime;
    // Filter cutoff also drifts per era so the tone color changes alongside
    // the chord. The LFO depth still rides on top of this baseline.
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
    this.filter.frequency.linearRampToValueAtTime(eraFilterCutoff(era), now + 2.2);
    // Crossfade voices. Fade out the old set, spin up the new set.
    this.stopVoices(2.0);
    setTimeout(() => {
      if (!this.enabled) return;
      this.startVoices(cfgs);
    }, 1800);
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

  // ensureContext lazily constructs the AudioContext and master gain plus
  // the shared low-pass filter that shapes the pad.
  private ensureContext(): void {
    if (this.ctx) return;
    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const w = window as WindowWithWebkit;
    const Ctor: typeof AudioContext | undefined = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = eraFilterCutoff(this.currentEra);
    this.filter.Q.value = 0.9;
    this.filter.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  // startAmbient builds the pad on the configured era. Sets up the global
  // LFOs that breathe the filter and shimmer one voice's gain.
  private startAmbient(): void {
    if (!this.ctx || !this.master || !this.filter) return;
    if (this.voices.length > 0) return;
    this.startVoices(eraVoices(this.currentEra));
    this.startModulators();
  }

  // stopAmbient stops every voice and modulator, intended for the master
  // disable path. The LFOs are torn down as well so the next enable starts
  // them fresh.
  private stopAmbient(): void {
    this.stopVoices(0.4);
    this.stopModulators();
  }

  // startVoices creates an oscillator/gain/pan triple for each VoiceConfig
  // and ramps the per-voice gain up. The whole stack feeds the shared
  // filter, so the LFO moves them as one body.
  private startVoices(cfgs: VoiceConfig[]): void {
    if (!this.ctx || !this.filter) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    for (const cfg of cfgs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      osc.type = cfg.type;
      osc.frequency.value = cfg.freq;
      osc.detune.value = cfg.detune;
      pan.pan.value = cfg.pan;
      gain.gain.value = 0;
      osc.connect(gain).connect(pan).connect(this.filter);
      osc.start();
      gain.gain.linearRampToValueAtTime(cfg.gain, now + 2.4);
      this.voices.push({ osc, gain, pan });
    }
    // Route the shimmer LFO to the first voice's gain so the chord's
    // emphasis drifts slowly between voices over time.
    if (this.voices.length > 0 && this.shimmer) {
      this.shimmer.gain.connect(this.voices[0].gain.gain);
    }
  }

  // stopVoices fades every running voice to zero over the given ramp seconds,
  // then disposes the oscillator nodes.
  private stopVoices(rampSec: number): void {
    if (!this.ctx) {
      this.voices = [];
      return;
    }
    const now = this.ctx.currentTime;
    const voices = this.voices;
    this.voices = [];
    for (const v of voices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.linearRampToValueAtTime(0, now + rampSec);
        v.osc.stop(now + rampSec + 0.1);
      } catch {
        // already stopped
      }
    }
  }

  // startModulators creates the slow filter-cutoff LFO and the voice-balance
  // shimmer LFO. Both are very slow so the changes are felt, not heard.
  private startModulators(): void {
    if (!this.ctx || !this.filter) return;
    const ctx = this.ctx;
    // Filter-sweep LFO: 0.05 Hz triangle (20 second period) wiggles the
    // cutoff ±180 Hz around the era baseline.
    {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 0.05;
      gain.gain.value = 180;
      osc.connect(gain).connect(this.filter.frequency);
      osc.start();
      this.lfo = { osc, gain };
    }
    // Shimmer LFO: 0.08 Hz sine wiggles one voice's gain so the chord
    // doesn't sit on the same balance for the whole session.
    {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 0.08;
      gain.gain.value = 0.06;
      osc.connect(gain);
      osc.start();
      this.shimmer = { osc, gain };
    }
  }

  // stopModulators disposes the LFOs created in startModulators.
  private stopModulators(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.lfo) {
      try { this.lfo.osc.stop(now + 0.1); } catch { /* ignore */ }
      this.lfo = null;
    }
    if (this.shimmer) {
      try { this.shimmer.osc.stop(now + 0.1); } catch { /* ignore */ }
      this.shimmer = null;
    }
  }
}

// eraVoices returns the chord and voice layout for a given era. Voices are
// always summed to roughly the same total gain so the master mix stays
// stable across eras. Pitches use 12-tone equal temperament. The chords
// are deliberately open (root + fifth + octave + colour) so the music
// reads as drone-meditative rather than melodic.
function eraVoices(era: string): VoiceConfig[] {
  // 12-tone equal temperament reference. A4 = 440.
  const note = (semitonesFromC0: number) => 440 * Math.pow(2, (semitonesFromC0 - 69) / 12);
  // Helpful named pitches (MIDI numbers):
  // C2=36, G2=43, C3=48, Eb3=51, E3=52, G3=55, A3=57, B3=59, C4=60, D4=62, F4=65, G4=67
  switch (era) {
    case 'ancient':
      // C minor open fifth, low and patient.
      return [
        { freq: note(36), type: 'triangle', detune: -8, pan: 0, gain: 0.22 },
        { freq: note(48), type: 'triangle', detune: 0, pan: -0.2, gain: 0.16 },
        { freq: note(55), type: 'sine', detune: 4, pan: 0.25, gain: 0.12 },
        { freq: note(63), type: 'sine', detune: -3, pan: 0.1, gain: 0.08 }, // D# upper
      ];
    case 'medieval':
      // D minor, gothic; pure fifth + minor third.
      return [
        { freq: note(38), type: 'triangle', detune: 0, pan: 0, gain: 0.22 },
        { freq: note(50), type: 'triangle', detune: 0, pan: -0.2, gain: 0.16 },
        { freq: note(57), type: 'sine', detune: -2, pan: 0.25, gain: 0.12 },
        { freq: note(65), type: 'sine', detune: 3, pan: 0.1, gain: 0.07 },
      ];
    case 'early-modern':
      // G major open, brighter and a little more lifted.
      return [
        { freq: note(43), type: 'triangle', detune: 0, pan: 0, gain: 0.2 },
        { freq: note(55), type: 'triangle', detune: 0, pan: -0.25, gain: 0.16 },
        { freq: note(62), type: 'sine', detune: 2, pan: 0.2, gain: 0.12 },
        { freq: note(67), type: 'sine', detune: -2, pan: 0.05, gain: 0.07 },
      ];
    case 'napoleonic':
      // E flat suspended (root + fifth + flat seventh), heroic but unresolved.
      return [
        { freq: note(39), type: 'triangle', detune: 0, pan: 0, gain: 0.21 },
        { freq: note(51), type: 'triangle', detune: 0, pan: -0.22, gain: 0.16 },
        { freq: note(58), type: 'sine', detune: 3, pan: 0.22, gain: 0.12 },
        { freq: note(61), type: 'sine', detune: -3, pan: 0.05, gain: 0.07 },
      ];
    case 'industrial':
      // A minor with added 2, mechanical but sad.
      return [
        { freq: note(45), type: 'sawtooth', detune: -6, pan: 0, gain: 0.18 },
        { freq: note(57), type: 'triangle', detune: 0, pan: -0.2, gain: 0.16 },
        { freq: note(60), type: 'sine', detune: 2, pan: 0.25, gain: 0.12 },
        { freq: note(64), type: 'sine', detune: -2, pan: 0.1, gain: 0.08 },
      ];
    case 'world-war-1':
      // B minor, deep and ominous.
      return [
        { freq: note(35), type: 'sawtooth', detune: -10, pan: 0, gain: 0.18 },
        { freq: note(47), type: 'triangle', detune: 0, pan: -0.2, gain: 0.16 },
        { freq: note(54), type: 'sine', detune: 4, pan: 0.25, gain: 0.12 },
        { freq: note(62), type: 'sine', detune: -4, pan: 0.05, gain: 0.07 },
      ];
    case 'interwar':
      // F minor with major 7, uneasy and lingering.
      return [
        { freq: note(41), type: 'triangle', detune: 0, pan: 0, gain: 0.2 },
        { freq: note(53), type: 'triangle', detune: 0, pan: -0.2, gain: 0.16 },
        { freq: note(60), type: 'sine', detune: 2, pan: 0.22, gain: 0.12 },
        { freq: note(64), type: 'sine', detune: -2, pan: 0.05, gain: 0.07 },
      ];
    case 'world-war-2':
      // D minor with sub octave, heavy and grave.
      return [
        { freq: note(38), type: 'sawtooth', detune: -8, pan: 0, gain: 0.18 },
        { freq: note(50), type: 'triangle', detune: 0, pan: -0.25, gain: 0.16 },
        { freq: note(53), type: 'sine', detune: 4, pan: 0.25, gain: 0.12 },
        { freq: note(57), type: 'sine', detune: -4, pan: 0.05, gain: 0.07 },
      ];
    case 'cold-war':
      // E phrygian (E + F + B), suspended and tense — air-raid-siren key.
      return [
        { freq: note(40), type: 'sawtooth', detune: -8, pan: 0, gain: 0.16 },
        { freq: note(52), type: 'triangle', detune: 0, pan: -0.25, gain: 0.16 },
        { freq: note(53), type: 'sine', detune: 4, pan: 0.25, gain: 0.10 },
        { freq: note(59), type: 'sine', detune: -3, pan: 0.05, gain: 0.08 },
      ];
    case 'contemporary':
      // F# minor with major-7 colour, glass-and-fibre key.
      return [
        { freq: note(42), type: 'sawtooth', detune: -8, pan: 0, gain: 0.15 },
        { freq: note(54), type: 'triangle', detune: 0, pan: -0.25, gain: 0.16 },
        { freq: note(57), type: 'sine', detune: 4, pan: 0.25, gain: 0.10 },
        { freq: note(65), type: 'sine', detune: -3, pan: 0.05, gain: 0.07 },
      ];
    default:
      // Neutral C major open: used on the splash and any unset era.
      return [
        { freq: note(36), type: 'triangle', detune: 0, pan: 0, gain: 0.2 },
        { freq: note(48), type: 'triangle', detune: 0, pan: -0.2, gain: 0.16 },
        { freq: note(55), type: 'sine', detune: 2, pan: 0.22, gain: 0.12 },
        { freq: note(64), type: 'sine', detune: -2, pan: 0.05, gain: 0.07 },
      ];
  }
}

// eraFilterCutoff is the low-pass cutoff baseline for each era. Lower
// numbers feel warmer and dimmer; higher numbers feel airy and modern. The
// LFO moves around this baseline by ±180 Hz.
function eraFilterCutoff(era: string): number {
  switch (era) {
    case 'ancient': return 480;
    case 'medieval': return 560;
    case 'early-modern': return 700;
    case 'napoleonic': return 820;
    case 'industrial': return 920;
    case 'world-war-1': return 980;
    case 'interwar': return 1040;
    case 'world-war-2': return 1100;
    case 'cold-war': return 1240;
    case 'contemporary': return 1320;
    default: return 880;
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
