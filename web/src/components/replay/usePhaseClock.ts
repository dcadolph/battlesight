// usePhaseClock runs a replay's phase clock: how long the shown phase has played, when its
// dwell runs out, and, with the narrator on, the voice that speaks it and the gate that
// holds the phase until the voice has spoken its last word. The elapsed time survives a
// pause, a resume, a speed change, and a narrator change, so a resumed phase plays only
// what is left of it.

import { useCallback, useEffect, useRef } from 'react';

import { speak, stopSpeech } from '../../audio/narration';
import { NARRATOR_RATE, VOICE_TAIL_MS } from '../../audio/pacing';

// PhaseClockInput is what the clock needs from the replay.
export interface PhaseClockInput {
  // phaseKey names one visit to one phase. It changes on every phase change and on every
  // jump, even to the phase already shown, so each visit starts its clock and voice fresh.
  phaseKey: string;
  // sentences are the phase's narration, one entry a sentence.
  sentences: string[];
  // dwellMs is how long the phase holds at speed 1.
  dwellMs: number;
  // voiceWaitMs is how long past the dwell the phase waits, at speed 1, for a voice that
  // never reports its last word.
  voiceWaitMs: number;
  // narrating is true when the narrator speaks this phase.
  narrating: boolean;
  // playing is true while the replay plays.
  playing: boolean;
  // ended is true once the outro shows.
  ended: boolean;
  // speed is the playback speed.
  speed: number;
  // onAdvance moves the replay past the phase.
  onAdvance: () => void;
  // onRefused reports that the browser refused to speak.
  onRefused: () => void;
}

// Gate is the clock of one phase visit.
interface Gate {
  // key is the visit the gate belongs to.
  key: string;
  // elapsed is the phase time played before the current run, in ms at speed 1.
  elapsed: number;
  // runSince is when the current run started, or -1 while paused.
  runSince: number;
  // runSpeed is the speed of the current run.
  runSpeed: number;
  // dwellDue is true once the dwell has run out.
  dwellDue: boolean;
  // voiceDone is true once the voice has spoken the last sentence.
  voiceDone: boolean;
  // voiceEndAt is when the voice spoke its last word, in performance time, or -1.
  voiceEndAt: number;
  // sentence is the sentence the voice speaks next, or speaks again after a stop.
  sentence: number;
  // wait is the pending tail or voice-wait timer.
  wait: ReturnType<typeof setTimeout> | undefined;
  // advanced is true once the gate has moved the replay on.
  advanced: boolean;
}

// newGate returns a fresh gate for a visit.
function newGate(key: string): Gate {
  return {
    key,
    elapsed: 0,
    runSince: -1,
    runSpeed: 1,
    dwellDue: false,
    voiceDone: false,
    voiceEndAt: -1,
    sentence: 0,
    wait: undefined,
    advanced: false,
  };
}

// usePhaseClock advances the replay when the shown phase is done and returns the share of
// its dwell played so far, for the scrubber.
export function usePhaseClock(input: PhaseClockInput): () => number {
  const { phaseKey, sentences, dwellMs, narrating, playing, ended, speed } = input;
  const live = useRef(input);
  useEffect(() => {
    live.current = input;
  });
  const gateRef = useRef<Gate>(newGate(''));

  // gateFor returns the gate of a visit, starting a fresh one when the visit changed.
  const gateFor = useCallback((key: string): Gate => {
    if (gateRef.current.key !== key) {
      clearTimeout(gateRef.current.wait);
      gateRef.current = newGate(key);
    }
    return gateRef.current;
  }, []);

  // advance moves the replay on once per visit.
  const advance = useCallback((g: Gate) => {
    clearTimeout(g.wait);
    g.wait = undefined;
    if (g.advanced || gateRef.current !== g) return;
    g.advanced = true;
    live.current.onAdvance();
  }, []);

  // decide moves the replay on when the dwell is out and the voice is done, and never
  // sooner than VOICE_TAIL_MS after the voice's last word, so the last words land before
  // the picture moves.
  const decide = useCallback((g: Gate) => {
    const cur = live.current;
    if (gateRef.current !== g || !g.dwellDue || g.advanced || !cur.playing || cur.ended) return;
    clearTimeout(g.wait);
    const sp = Math.max(0.1, cur.speed);
    if (cur.narrating && !g.voiceDone) {
      g.wait = setTimeout(() => advance(g), cur.voiceWaitMs / sp);
      return;
    }
    const tail = cur.narrating && g.voiceEndAt >= 0 ? g.voiceEndAt + VOICE_TAIL_MS / sp - performance.now() : 0;
    if (tail > 0) {
      g.wait = setTimeout(() => advance(g), tail);
      return;
    }
    advance(g);
  }, [advance]);

  // The dwell timer. It runs only while playing and arms for what is left of the dwell.
  useEffect(() => {
    const g = gateFor(phaseKey);
    if (!playing || ended) return;
    const sp = Math.max(0.1, speed);
    g.runSince = performance.now();
    g.runSpeed = sp;
    const t = setTimeout(() => {
      g.dwellDue = true;
      decide(g);
    }, Math.max(0, dwellMs - g.elapsed) / sp);
    return () => {
      clearTimeout(t);
      clearTimeout(g.wait);
      g.wait = undefined;
      g.elapsed += (performance.now() - g.runSince) * g.runSpeed;
      g.runSince = -1;
    };
  }, [phaseKey, playing, ended, speed, dwellMs, gateFor, decide]);

  // The voice. It speaks while playing from the sentence the gate holds, and a stop keeps
  // the sentence in progress so play speaks it again from its start.
  useEffect(() => {
    const g = gateFor(phaseKey);
    if (!narrating || !playing || ended || g.voiceDone) return;
    // The sentences are empty until the replay has loaded, and playing is false until then,
    // so only a loaded phase with no narration counts as spoken.
    if (sentences.length === 0) {
      g.voiceDone = true;
      decide(g);
      return;
    }
    speak(sentences, g.sentence, NARRATOR_RATE * Math.max(0.1, speed), {
      onSentence: (i) => {
        g.sentence = i;
      },
      onDone: () => {
        g.voiceDone = true;
        g.voiceEndAt = performance.now();
        decide(g);
      },
      onRefused: () => {
        if (gateRef.current === g) live.current.onRefused();
      },
    });
    return () => {
      const at = stopSpeech();
      if (!g.voiceDone) g.sentence = at;
    };
  }, [phaseKey, sentences, narrating, playing, ended, speed, gateFor, decide]);

  // A narrator switched off while the phase waits for the voice lets it move on.
  useEffect(() => {
    if (!narrating) decide(gateFor(phaseKey));
  }, [narrating, phaseKey, gateFor, decide]);

  // Stop the voice and any pending timer when the replay closes.
  useEffect(() => {
    return () => {
      clearTimeout(gateRef.current.wait);
      stopSpeech();
    };
  }, []);

  return useCallback(() => {
    const g = gateRef.current;
    const cur = live.current;
    if (g.key !== cur.phaseKey || cur.dwellMs <= 0) return 0;
    let played = g.elapsed;
    if (g.runSince >= 0) played += (performance.now() - g.runSince) * g.runSpeed;
    return Math.min(1, played / cur.dwellMs);
  }, []);
}
