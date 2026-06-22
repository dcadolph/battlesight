// narration: browser SpeechSynthesis wrapper for replay phase
// narration. The caller invokes narrate(text) on every phase advance;
// the wrapper cancels any in-flight utterance, picks the best system
// voice available, and starts the new one.
//
// Browsers gate SpeechSynthesis behind a user gesture. In this app the
// user always clicks "Watch the replay" first, so by the time we begin
// narrating the gesture has registered.
//
// Voice quality is whatever the host OS ships. macOS Samantha / Daniel
// are clean; Chrome on most platforms exposes "Google US English" which
// is also serviceable. Falls back to the first English voice and then
// to the first available voice.

import { soundEnabled } from './sound';

let cachedVoice: SpeechSynthesisVoice | null = null;
let currentUtter: SpeechSynthesisUtterance | null = null;
let voiceChangedHooked = false;

// PREFERRED_VOICES in priority order. Names match the actual voice
// objects exposed by SpeechSynthesis on each platform — macOS uses
// proper names (Samantha, Daniel), Google Chrome uses a "Google US
// English" branded list, Microsoft Edge exposes Aria / Guy.
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

// pickVoice walks the system voice list looking for the highest-quality
// English voice we recognise. Memoised in cachedVoice.
function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  for (const name of PREFERRED_VOICES) {
    const v = voices.find((vv) => vv.name === name || vv.name.startsWith(name));
    if (v) { cachedVoice = v; return v; }
  }
  const en = voices.find((v) => v.lang.startsWith('en'));
  if (en) { cachedVoice = en; return en; }
  cachedVoice = voices[0];
  return cachedVoice;
}

// ensureVoicesLoaded subscribes to the voiceschanged event the first
// time anything is narrated. Some browsers populate the voice list
// asynchronously; without this the first phase narration would fall
// back to a default voice and stick there.
function ensureVoicesLoaded() {
  if (voiceChangedHooked || typeof speechSynthesis === 'undefined') return;
  voiceChangedHooked = true;
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoice = null;
  });
}

// narrate speaks the given text. Cancels any in-flight utterance so a
// rapid phase advance doesn't queue up overlapping voiceovers. Honours
// the global sound enabled flag — no narration when the user has
// muted the soundtrack. onEnd fires when speech completes or is
// interrupted; callers can use it to advance state.
export function narrate(text: string, opts?: { rate?: number; pitch?: number; onEnd?: () => void }): void {
  if (typeof speechSynthesis === 'undefined' || !text) return;
  if (!soundEnabled()) return;
  ensureVoicesLoaded();
  cancelNarration();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  }
  utter.rate = opts?.rate ?? 0.95;
  utter.pitch = opts?.pitch ?? 1.0;
  utter.volume = 1;
  if (opts?.onEnd) utter.onend = opts.onEnd;
  currentUtter = utter;
  // Safari occasionally drops the first utterance when called right
  // after cancel(). Defer one frame so the cancellation settles.
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => speechSynthesis.speak(utter));
  } else {
    speechSynthesis.speak(utter);
  }
}

// cancelNarration stops any in-flight utterance. Safe to call when
// nothing is speaking. Used on phase change, replay close, and unmount.
export function cancelNarration(): void {
  if (typeof speechSynthesis === 'undefined') return;
  if (currentUtter || speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    currentUtter = null;
  }
}

// pauseNarration pauses without losing the utterance. resumeNarration
// continues from the same word. Used by the play/pause control so a
// paused replay does not keep talking.
export function pauseNarration(): void {
  if (typeof speechSynthesis === 'undefined') return;
  if (speechSynthesis.speaking && !speechSynthesis.paused) {
    speechSynthesis.pause();
  }
}

export function resumeNarration(): void {
  if (typeof speechSynthesis === 'undefined') return;
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
  }
}
