// narration: the replay narrator, spoken with the browser's SpeechSynthesis. A phase's
// narration is spoken one sentence an utterance, each started when the one before ends.
// Stopping reports the sentence in progress, so play can speak again from its start. The
// utterance in flight stays referenced: Chrome lets an unreferenced utterance be collected,
// and its events then never arrive.

import { NARRATOR_RATE, sentenceMs } from './pacing';
//
// Voice quality is whatever the host OS ships. macOS Samantha and Daniel are clean, Chrome
// on most platforms exposes "Google US English", Edge exposes Aria and Guy. Falls back to
// the first English voice and then to the first available voice.

// PREFERRED_VOICES are the voices tried first, in order.
const PREFERRED_VOICES = [
  'Samantha',
  'Daniel',
  'Karen',
  'Alex',
  'Google US English',
  'Google UK English Female',
  'Google UK English Male',
  'Microsoft Aria',
  'Microsoft Guy',
  'Microsoft Eric',
];

// NARRATOR_KEY is the localStorage key that remembers the narrator switch.
const NARRATOR_KEY = 'bs.narrator';

// START_WAIT_MS is how long a sentence may take to start before it is spoken again.
const START_WAIT_MS = 2000;

// START_TRIES is how many times a sentence that never starts is spoken again.
const START_TRIES = 2;

// END_GRACE_MS is the slack past twice a sentence's estimate before it counts as stuck.
const END_GRACE_MS = 2000;

let cachedVoice: SpeechSynthesisVoice | null = null;
let voiceChangedHooked = false;
// generation numbers each spoken run. Events from an earlier run are ignored.
let generation = 0;
// held keeps the utterances of the live run referenced until it ends.
let held: SpeechSynthesisUtterance[] = [];
// current is the sentence the live run is speaking, or the one it starts from.
let current = 0;

// SpeechEvents are the callbacks of one spoken run.
export interface SpeechEvents {
  // onSentence fires when a sentence starts, with its index.
  onSentence?: (index: number) => void;
  // onDone fires when the last sentence ends.
  onDone?: () => void;
  // onRefused fires when the browser refuses to speak before the page has had a click.
  onRefused?: () => void;
}

// pickVoice returns the best voice the system offers, memoized in cachedVoice.
function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  for (const name of PREFERRED_VOICES) {
    const v = voices.find((vv) => vv.name === name || vv.name.startsWith(name));
    if (v) {
      cachedVoice = v;
      return v;
    }
  }
  cachedVoice = voices.find((v) => v.lang.startsWith('en')) ?? voices[0];
  return cachedVoice;
}

// ensureVoicesLoaded drops the memoized voice when the system list changes. Some browsers
// fill the list late, and without this the first phase would keep a fallback voice.
function ensureVoicesLoaded(): void {
  if (voiceChangedHooked) return;
  voiceChangedHooked = true;
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoice = null;
  });
}

// speechSupported reports whether the browser has a speech engine.
export function speechSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

// speechAllowed reports whether the browser will speak now. Browsers refuse speech until
// the page has had a click. Where the activation API is missing this answers yes, and a
// refusal arrives as a not-allowed error instead.
export function speechAllowed(): boolean {
  if (typeof navigator === 'undefined') return false;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation ? activation.hasBeenActive : true;
}

// narratorPreferred reports whether the viewer turned the narrator on. Off by default, since
// captions carry the story and the browser's voice is not good enough to speak first.
export function narratorPreferred(): boolean {
  try {
    return localStorage.getItem(NARRATOR_KEY) === 'on';
  } catch {
    return false;
  }
}

// setNarratorPreferred remembers the narrator switch in this browser.
export function setNarratorPreferred(on: boolean): void {
  try {
    if (on) localStorage.setItem(NARRATOR_KEY, 'on');
    else localStorage.removeItem(NARRATOR_KEY);
  } catch {
    // Private windows and blocked storage forget the switch; the page works without it.
  }
}

// speak speaks sentences from index from on, one at a time, at the rate given, after
// stopping anything spoken before. Chrome's speech queue can stall, so each sentence has a
// watchdog: one that has not started after START_WAIT_MS is canceled and spoken again, up
// to START_TRIES times, and one that has not ended after twice its estimate plus
// END_GRACE_MS is canceled and the next one spoken.
export function speak(sentences: string[], from: number, rate: number, events: SpeechEvents): void {
  stopSpeech();
  if (!speechSupported() || from >= sentences.length) return;
  ensureVoicesLoaded();
  const gen = generation;
  current = from;
  const say = (index: number, tries: number) => {
    if (gen !== generation) return;
    if (index >= sentences.length) {
      held = [];
      events.onDone?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(sentences[index]);
    const voice = pickVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = rate;
    u.pitch = 1;
    u.volume = 1;
    held = [u];
    let settled = false;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (then: () => void) => {
      if (settled || gen !== generation) return;
      settled = true;
      clearTimeout(startTimer);
      clearTimeout(endTimer);
      then();
    };
    const startTimer = setTimeout(() => settle(() => {
      speechSynthesis.cancel();
      say(tries < START_TRIES ? index : index + 1, tries < START_TRIES ? tries + 1 : 0);
    }), START_WAIT_MS);
    u.onstart = () => {
      if (settled || gen !== generation) return;
      clearTimeout(startTimer);
      current = index;
      events.onSentence?.(index);
      const expected = (sentenceMs(sentences[index]) * NARRATOR_RATE) / Math.max(0.05, rate);
      endTimer = setTimeout(() => settle(() => {
        speechSynthesis.cancel();
        say(index + 1, 0);
      }), 2 * expected + END_GRACE_MS);
    };
    u.onend = () => settle(() => say(index + 1, 0));
    u.onerror = (e) => {
      if (e.error === 'not-allowed') {
        settle(() => {
          stopSpeech();
          events.onRefused?.();
        });
        return;
      }
      // A cancel of our own reports interrupted or canceled after the watchdog moved on.
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      settle(() => say(index + 1, 0));
    };
    speechSynthesis.speak(u);
  };
  // Safari can drop the first utterance spoken right after a cancel. One frame lets the
  // cancel settle.
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => say(from, 0));
  else say(from, 0);
}

// stopSpeech stops whatever is spoken and returns the sentence that was in progress.
export function stopSpeech(): number {
  generation++;
  const at = current;
  if (held.length > 0 && speechSupported()) speechSynthesis.cancel();
  held = [];
  return at;
}
