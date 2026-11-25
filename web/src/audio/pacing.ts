// Narration pacing for replays: how a phase's narration is split into the sentences the
// voice speaks one at a time, how long the voice takes to speak them, and how long a phase
// lasts while the narrator speaks. Pure arithmetic with no browser imports, so the page and
// the Node checks share it.
//
// The estimate is fitted to Samantha, the first preferred voice, in Chrome on macOS at
// NARRATOR_RATE. The page never trusts it alone: a phase also waits for the voice to report
// its last word, so the estimate places the moves of the Map view and sets the dwell, and
// the voice decides the moment the phase moves on.

// NARRATOR_RATE is the voice rate at playback speed 1. The rate scales with the speed.
export const NARRATOR_RATE = 0.95;

// NARRATION_TAIL_MS is the still time a narrated dwell keeps after the estimated last word.
export const NARRATION_TAIL_MS = 1000;

// VOICE_TAIL_MS is how long a phase holds after the voice's last word when the voice ends
// after the dwell.
export const VOICE_TAIL_MS = 800;

// VOICE_WAIT_MIN_MS is the least a phase waits past its dwell for a voice that never
// reports its last word.
export const VOICE_WAIT_MIN_MS = 4000;

// MS_PER_SYLLABLE is the fitted speaking time of one syllable at speed 1.
export const MS_PER_SYLLABLE = 190;

// MS_PER_PAUSE is the fitted time of the pause at a comma, colon, semicolon, or dash.
export const MS_PER_PAUSE = 300;

// MS_PER_SENTENCE is the fitted fixed cost of one sentence, its closing pause included.
export const MS_PER_SENTENCE = 340;

// ABBREVIATIONS are words that end in a period without ending a sentence.
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'mt', 'ft', 'gen', 'lt', 'col', 'capt', 'maj', 'sgt', 'adm',
  'cpl', 'pvt', 'fr', 'jr', 'sr', 'vs', 'ca', 'approx', 'co', 'corp', 'inc', 'ltd',
]);

// BREAK finds a candidate sentence end: closing punctuation, any closing quotes or
// brackets, then space before a capital letter, a digit, or an opening quote or bracket.
const BREAK = /[.!?]+["'”’)\]]*\s+(?=["'“‘([]?[A-Z0-9])/g;

// splitSentences splits narration into the sentences the voice speaks one at a time. A
// period after an initial, a dotted acronym, a listed abbreviation, or "No" before a number
// does not end a sentence. A missed break only makes one utterance longer.
export function splitSentences(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  BREAK.lastIndex = 0;
  for (let m = BREAK.exec(text); m !== null; m = BREAK.exec(text)) {
    if (m[0][0] === '.') {
      const head = text.slice(start, m.index);
      const word = head.slice(head.search(/\S+$/)).replace(/^["'“‘([]+/, '');
      const next = text.slice(m.index + m[0].length);
      if (/^[A-Za-z]$/.test(word)) continue;
      if (/^(?:[A-Za-z]\.)+[A-Za-z]$/.test(word)) continue;
      if (ABBREVIATIONS.has(word.toLowerCase())) continue;
      if (word === 'No' && /^\d/.test(next)) continue;
    }
    const sentence = text.slice(start, m.index + m[0].trimEnd().length).trim();
    if (sentence) out.push(sentence);
    start = m.index + m[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// NUMBER_SYLLABLES is a rough syllable count for a number the voice reads aloud, by its
// digit count: "7" is one or two, "1942" reads as "nineteen forty-two".
const NUMBER_SYLLABLES = [0, 1.5, 2.5, 4, 4.5, 6, 7, 8];

// syllables estimates the syllables the voice speaks for one word.
function syllables(word: string): number {
  const digits = word.replace(/[^0-9]/g, '');
  if (digits.length > 0 && digits.length === word.replace(/[^0-9A-Za-z]/g, '').length) {
    return NUMBER_SYLLABLES[Math.min(digits.length, NUMBER_SYLLABLES.length - 1)];
  }
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) return 0;
  const groups = letters.match(/[aeiouy]+/g)?.length ?? 0;
  const silentE = letters.length > 2 && letters.endsWith('e') && !/[aeiouy]e$|le$/.test(letters) ? 1 : 0;
  return Math.max(1, groups - silentE);
}

// SpeechUnits are the parts of a sentence the estimate counts.
export interface SpeechUnits {
  // syllables is the estimated number of spoken syllables.
  syllables: number;
  // pauses is the number of commas, colons, semicolons, and dashes.
  pauses: number;
}

// speechUnits counts the syllables and pauses of one sentence.
export function speechUnits(sentence: string): SpeechUnits {
  let count = 0;
  for (const word of sentence.split(/[\s‐-―-]+/)) count += syllables(word);
  const pauses = (sentence.match(/[,;:–—]|\s-\s/g) ?? []).length;
  return { syllables: count, pauses };
}

// sentenceMs estimates how long the narrator takes to speak one sentence at speed 1.
export function sentenceMs(sentence: string): number {
  const u = speechUnits(sentence);
  return Math.round(u.syllables * MS_PER_SYLLABLE + u.pauses * MS_PER_PAUSE + MS_PER_SENTENCE);
}

// spokenMs estimates how long the narrator takes to speak a phase's narration at speed 1.
export function spokenMs(text: string | undefined): number {
  let total = 0;
  for (const s of splitSentences(text)) total += sentenceMs(s);
  return total;
}

// narratedDwellMs returns a phase's dwell at speed 1 while the narrator speaks it: the base
// dwell, or the spoken estimate plus the tail when that is longer.
export function narratedDwellMs(baseMs: number, text: string | undefined): number {
  const spoken = spokenMs(text);
  return spoken > 0 ? Math.max(baseMs, spoken + NARRATION_TAIL_MS) : baseMs;
}

// voiceWaitMs returns how long past its dwell a phase waits, at speed 1, for a voice that
// never reports its last word.
export function voiceWaitMs(text: string | undefined): number {
  return Math.max(VOICE_WAIT_MIN_MS, spokenMs(text) / 2);
}

// sentenceAt returns which sentence a caption shows once playedMs of a phase's dwellMs has
// played at speed 1, when no voice reports its place. Each sentence holds for its spoken
// estimate, stretched evenly when the dwell is longer than the sentences need, and the last
// sentence holds to the end of the phase.
export function sentenceAt(sentences: string[], playedMs: number, dwellMs: number): number {
  if (sentences.length <= 1) return 0;
  const ends: number[] = [];
  let total = 0;
  for (const s of sentences) {
    total += sentenceMs(s);
    ends.push(total);
  }
  const scale = Math.max(total, dwellMs - NARRATION_TAIL_MS) / total;
  for (let i = 0; i < ends.length - 1; i++) {
    if (playedMs < ends[i] * scale) return i;
  }
  return ends.length - 1;
}
