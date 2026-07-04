import { useEffect, useRef, useState, useCallback } from 'react';
import type { Battle } from '../../types/battle';
import { regionalEraContext } from '../../types/battle';
import type { Replay } from '../../types/replay';
import { factionColorFor } from '../../types/replay';
import TacticalMap from './TacticalMap';
import GlobeReplay from './GlobeReplay';
import TacticalSurface from './TacticalSurface';
import { themeForEra } from '../../theme/era';
import { playPhaseAdvance, setSoundEra } from '../../audio/sound';
import { narrate, cancelNarration, pauseNarration, resumeNarration } from '../../audio/narration';
import { usePauseOnHidden } from '../../hooks/usePauseOnHidden';
import { cleanCasualtyText, cleanProseText, formatBattleDate } from '../../lib/format';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import CloseButton from '../CloseButton';
import { findSnapshot, buildCountryColorMap } from '../../data/territory-snapshots';
import { cachedReplay, loadReplay } from '../../data/replay-cache';

interface BattleReplayProps {
  battle: Battle;
  initialPhase?: number;
  onClose: () => void;
  onPhaseChange?: (phaseIndex: number) => void;
  // cinematicMode is true when BattleReplay is mounted inside a war
  // cinematic playback. In that mode the per-battle outro no longer shows
  // its interactive "Replay / Back" buttons (the war timer is in charge
  // of advancement); instead it surfaces a compact "Next battle in a
  // moment" indicator and leaves the final tactical frame visible until
  // the parent advances.
  cinematicMode?: boolean;
  // onEnded fires once a short outro pause has elapsed after the replay's
  // final phase finishes. War cinematic playback wires this to advance
  // to the next battle as soon as the outro card has had time to register,
  // instead of waiting on a wall-clock dwell budget that can be shorter
  // than the actual phase total. Only fired once per replay instance.
  onEnded?: () => void;
  // outroPauseMs is how long the outro card stays visible after ended
  // before onEnded fires. Default 2400ms reads as "this battle is done,
  // here comes the next one" without lingering.
  outroPauseMs?: number;
  // warCountryColors flows the active war-territory snapshot from App
  // straight through to the inner GlobeReplay so country-level shading
  // stays visible while watching an individual battle inside a war
  // cinematic. Without it, opening a replay collapses the globe to just
  // the highlighted host country and the user loses the campaign sweep.
  warCountryColors?: Record<string, string>;
  // warFactionAnchors + warSnapshotYear drive the in-replay faction
  // identity overlay (period-accurate flag banner + editorial label per
  // controlling power) so the user can tell red Reich from red USSR at
  // a glance while watching a battle inside a war cinematic.
  warFactionAnchors?: Array<{ faction: string; anchor: string }>;
  warSnapshotYear?: number;
  // onAdvanceNext / onAdvancePrev are imperative jumps to the next or
  // previous battle in the war cinematic sequence. When provided, they
  // surface manual next/prev buttons in the outro card so the user always
  // has a way to push past a stuck auto-advance. Each takes precedence
  // over the timer-driven onEnded path.
  onAdvanceNext?: () => void;
  onAdvancePrev?: () => void;
}

export default function BattleReplay({ battle, initialPhase = 0, onClose, onPhaseChange, cinematicMode = false, onEnded, outroPauseMs = 2400, warCountryColors, warFactionAnchors, warSnapshotYear, onAdvanceNext, onAdvancePrev }: BattleReplayProps) {
  const [replay, setReplay] = useState<Replay | null>(() => cachedReplay(battle.id));
  const [phaseIdx, setPhaseIdx] = useState(initialPhase);
  // The opaque full-screen veil that used to wait on globeUp +
  // minDwell + polygon-paint conditions was the cold-load problem.
  // Now the globe renders immediately and a small floating title slate
  // (see TitleSlate in the JSX below) fades over the live action for
  // ~1.6s as an orientation cue, then gets out of the way.
  // Auto-play on open. Opening "Watch the battle" implies "play it". Making
  // the user hunt for a play button to see anything happen is a poor default.
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // Default view is the globe. Auto-switching to the tactical schematic
  // was reverted: curated phases for lat/lng-only battles (Normandy and
  // most modern battles) leave x/y at the placeholder 50/50, so the
  // TacticalMap stacks every unit and movement at the centre of the
  // schematic. The globe carries real coastline imagery and is the only
  // sensible default. The toggle still lets the user pick TacticalMap
  // explicitly for older abstract-schematic battles (Marathon, Cannae)
  // where x/y is real curated data.
  const [view, setView] = useState<'globe' | 'tactical' | 'surface'>('surface');
  // ended is true after the last phase's dwell completes. It triggers the
  // outro card so the replay lands with intention instead of just freezing
  // on the final tactical state. Cleared whenever the user scrubs back.
  const [ended, setEnded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Honour the OS-level "Reduce motion" preference: phase timer collapses
  // to the next phase with no dwell so the user steps through frames
  // rather than waiting on animated transitions. Decorative pulse keyframes
  // and arrow marching animations are expected to be no-ops under this
  // mode (handled in CSS @media blocks).
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    // loadReplay resolves synchronously-fast from the module cache when the
    // replay is already hot (the state initializer covers the mount case),
    // so a battle change swaps the data within a microtask.
    let cancelled = false;
    loadReplay(battle.id).then((data) => {
      if (cancelled) return;
      if (data) {
        setReplay(data);
        setError(null);
      } else {
        setError('No replay available for this battle.');
      }
    });
    return () => { cancelled = true; };
  }, [battle.id]);

  useEffect(() => {
    if (!playing || !replay) return;
    const current = replay.phases[phaseIdx];
    // Reduced-motion path: skip the dwell entirely. The user can still
    // step through with the scrubber if they want to read each phase.
    // Auto-generated schematic replays get a faster per-phase tick (3.2s
    // each instead of 5.5s) since their movements are minimal and lingering
    // on a deployment-only phase reads as "stuck" — three of them ran 16.5s
    // total at the default rate, which was longer than the schematic dwell
    // backstop and produced the deployment-loop the user reported.
    // Phase dwell. Curator-set durations win; the default fallback was
    // 5500 ms hand-crafted and 3200 ms schematic — both glacial for an
    // 11-phase battle. Slashed to 3000 / 2000. Eleven phases × 5.5s =
    // a minute on rails; 3s/phase keeps the cinematic flow but lets a
    // viewer get through a battle without checking out.
    const baseDur = current.durationMs ?? (replay.schematic ? 2000 : 3000);
    const dur = prefersReducedMotion ? 0 : baseDur / speed;
    timerRef.current = setTimeout(() => {
      if (phaseIdx >= replay.phases.length - 1) {
        // Last phase finished its dwell. Trigger the outro card so the
        // replay reads as "battle over" instead of freezing on the final
        // tactical state.
        setPlaying(false);
        setEnded(true);
        return;
      }
      setPhaseIdx((i) => i + 1);
    }, dur);
    return () => clearTimeout(timerRef.current);
  }, [playing, phaseIdx, replay, speed, prefersReducedMotion]);

  useEffect(() => {
    onPhaseChange?.(phaseIdx);
    // Soft thump on every phase advance. No-op when sound is disabled.
    playPhaseAdvance();
    // Browser TTS narration of the current phase. Cancels any in-flight
    // utterance first so rapid advances don't queue overlapping voices.
    // Only fires while playing — paused scrubbing doesn't trigger speech.
    if (replay && playing) {
      const text = replay.phases[phaseIdx]?.narration;
      if (text) narrate(text);
    }
  }, [phaseIdx, onPhaseChange, replay, playing]);

  // Pause / resume the narration when the user toggles play. Without
  // this, a paused replay keeps the voiceover going past the visible
  // dwell, which reads as the audio leading the action.
  useEffect(() => {
    if (playing) resumeNarration();
    else pauseNarration();
  }, [playing]);

  // Cancel any in-flight narration on unmount (replay closed, war
  // cinematic advanced past this battle, etc.). Without this the
  // SpeechSynthesis queue keeps talking after the visible chrome is gone.
  useEffect(() => {
    return () => { cancelNarration(); };
  }, []);

  // Fire onEnded a short pause after the replay's final phase lands. The
  // pause gives the outro card time to read; the callback then lets the
  // parent (war cinematic) advance immediately without waiting on a
  // separate dwell timer. Reduced-motion path collapses the pause to 0.
  useEffect(() => {
    if (!ended || !onEnded) return;
    const t = setTimeout(onEnded, prefersReducedMotion ? 0 : outroPauseMs);
    return () => clearTimeout(t);
  }, [ended, onEnded, outroPauseMs, prefersReducedMotion]);

  // Tint the ambient bed to the battle's era while the replay is open.
  useEffect(() => {
    setSoundEra(battle.era || '');
  }, [battle.era]);

  // Pause the phase advance whenever the tab is hidden or the window blurs.
  // Without this the timer keeps firing in the background, the user comes
  // back to find the replay finished, and the audio drone keeps playing
  // even though nothing is on screen.
  // Pause-on-hidden only applies in standalone (dossier) viewing. During
  // cinematic playback the war timer is the source of truth: pausing the
  // inner replay while the outer cinematic keeps advancing leaves the
  // inner stuck on a frozen frame after the user resumes, which is the
  // bug that "shits the bed after Battle of France". Skip the pause in
  // cinematic mode and let the outer war timer drive everything.
  usePauseOnHidden(useCallback(() => {
    if (cinematicMode) return;
    setPlaying(false);
  }, [cinematicMode]));

  const goto = useCallback((i: number) => {
    if (!replay) return;
    const clamped = Math.max(0, Math.min(replay.phases.length - 1, i));
    setPhaseIdx(clamped);
    // Any manual phase change clears the outro card. The user has chosen
    // to engage with the replay again; do not occlude it.
    setEnded(false);
  }, [replay]);

  // restartReplay rewinds to the first phase and starts playing again. Used
  // by the outro card so a viewer can re-watch without leaving the overlay.
  const restartReplay = useCallback(() => {
    if (!replay) return;
    setPhaseIdx(0);
    setEnded(false);
    setPlaying(true);
  }, [replay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') {
        if (cinematicMode && onAdvanceNext) onAdvanceNext();
        else goto(phaseIdx + 1);
      }
      else if (e.key === 'ArrowLeft') {
        if (cinematicMode && onAdvancePrev) onAdvancePrev();
        else goto(phaseIdx - 1);
      }
      else if (e.key === ' ') {
        e.preventDefault();
        // SPACE in cinematic mode is a footgun: pausing the inner replay
        // leaves the outer war timer ticking and the user ends up stuck
        // on a frozen phase that the cinematic can't recover from
        // (Stalingrad freeze). Ignore it; the war cinematic's own
        // play/pause control owns the playing state.
        if (!cinematicMode) setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goto, phaseIdx, cinematicMode, onAdvanceNext, onAdvancePrev]);

  if (error) {
    return (
      <div className="fixed inset-0 bg-[#0a0d18]/95 backdrop-blur-md z-50 flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <div className="text-slate-300 mb-4">{error}</div>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600">
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!replay) {
    return (
      <div className="fixed inset-0 bg-[#0a0d18]/95 backdrop-blur-md z-50 flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const phase = replay.phases[phaseIdx];
  const aspectRatio = replay.aspectRatio ?? 1.6;
  const theme = themeForEra(battle.era);

  return (
    <div className="fixed inset-0 bg-[#070912] z-50 flex flex-col" style={{ animation: 'replay-fade-in 280ms ease-out forwards' }}>
      <style>{`
        @keyframes replay-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
      <style>{`
        @keyframes dash-in {
          to { stroke-dashoffset: 0; }
        }
        @keyframes arrow-fade-in {
          to { opacity: 1; }
        }
        /* Smoke / haze trail: a wide blurred band that fills in alongside
           the arrow stroke, then lingers at low opacity after the comet
           passes so the path of the force remains visible. */
        @keyframes arrow-haze-in {
          0%   { opacity: 0; }
          35%  { opacity: 0.85; }
          100% { opacity: 0.55; }
        }
        /* Arrow trace-in: the line draws itself from start to destination.
           pathLength=1 on the path means stroke-dashoffset ranges from 1 to 0
           regardless of geometric length. */
        @keyframes arrow-trace {
          from { stroke-dashoffset: 1; }
          to   { stroke-dashoffset: 0; }
        }
        /* As the marching dashes take over, dim the shaft stroke to a
           quiet underline so the dashes pop as the motion signal but the
           shaft stays visible as the line of advance. */
        @keyframes arrow-shaft-settle {
          to { opacity: 0.42; }
        }
        /* Legacy: trace-fade fully hid the shaft after dashes started.
           Replaced by arrow-shaft-settle above; kept here so any leftover
           reference does not break. */
        @keyframes arrow-trace-fade {
          to { opacity: 0; }
        }
        /* The marching layer carries the arrowhead and fades in only after
           the trace has landed. */
        @keyframes arrow-march-in {
          to { opacity: 0.92; }
        }
        /* Marching dashes that run continuously along an arrow after the
           trace lands. Offsets the dash pattern by one period so the eye
           reads as motion along the line of advance. */
        @keyframes arrow-march-flow {
          to { stroke-dashoffset: -7.2; }
        }
        /* Arrowhead pulse fires once when the trace lands at a charge or
           flank arrow's destination. Bright core that grows and fades, so
           the impact moment has a visible accent without painting the
           whole field. */
        @keyframes arrowhead-pulse {
          0%   { opacity: 0; transform: scale(0.4); }
          18%  { opacity: 1; transform: scale(1.0); }
          55%  { opacity: 0.75; transform: scale(1.7); }
          100% { opacity: 0; transform: scale(2.6); }
        }
        /* Glow underlay fades in alongside the trace and stays. */
        @keyframes arrow-glow-in {
          to { stroke-opacity: 0.55; }
        }
        /* Wider outer halo: lower opacity, fatter blur, gives the line
           cinematic volume. */
        @keyframes arrow-halo-in {
          to { stroke-opacity: 0.45; }
        }
        /* Atmospheric volume: huge soft glow ring behind every arrow, fades
           in slow and lingers low so the front of advance keeps a luminous
           ghost long after the trace lands. Reads from cinematic distance. */
        @keyframes arrow-vol-in {
          to { stroke-opacity: 0.22; }
        }
        /* Solid spine underneath the marching dashes. Always-visible thin
           line so the arrow path reads as continuous even when the march
           dashes happen to gap. Lives at lower opacity so the dashed motion
           still carries the eye. */
        @keyframes arrow-spine-in {
          to { opacity: 0.55; }
        }
        /* Comet head: a short bright window slides along the path during the
           trace. strokeDasharray='0.06 1' means a 6% visible segment on a
           pathLength=1 stroke; setting strokeDashoffset from 1 to 0.06 slides
           that window from the start of the path to the end. */
        @keyframes arrow-comet {
          from { stroke-dashoffset: 1; }
          to   { stroke-dashoffset: 0.06; }
        }
        /* Fade the comet in fast so it appears at the same moment as the
           trace, then fade out at the end so it doesn't sit at the arrowhead
           after impact. */
        @keyframes arrow-comet-fade {
          to { opacity: 1; }
        }
        @keyframes arrow-comet-out {
          to { opacity: 0; }
        }
        /* Marching-dash animation for the globe replay's SVG arrows. The
           --march custom property carries each arrow's dash+gap period so the
           pattern shifts by exactly one period per cycle and loops seamlessly.
           Without var(...), every arrow would have to share one fixed period. */
        @keyframes march {
          to { stroke-dashoffset: var(--march, -24px); }
        }
        /* Unit marker pop-in with overshoot. Pairs with the cubic-bezier on
           the element so it slightly bounces past 1.0 before settling. */
        @keyframes unit-pop-in {
          0%   { opacity: 0; transform: scale(0.4); }
          100% { opacity: 1; transform: scale(1); }
        }
        /* Halo "breath" — barely-perceptible scale oscillation so the units
           feel alive rather than printed. */
        @keyframes unit-halo-breath {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.12); opacity: 0.85; }
        }
        /* Impact-flash animations for the moment an arrow arrives at its
           destination. impact-core is the bright center dot that pops and
           fades; impact-ring is the outward shockwave. transform-box: fill-box
           on the rendered element ensures scale operates from the circle's
           own center, not the SVG origin. */
        @keyframes impact-core {
          0% { opacity: 0; transform: scale(0.2); }
          20% { opacity: 1; transform: scale(1.0); }
          60% { opacity: 0.6; transform: scale(0.7); }
          100% { opacity: 0; transform: scale(0.5); }
        }
        @keyframes impact-ring {
          0% { opacity: 0; transform: scale(0.4); }
          12% { opacity: 0.95; }
          100% { opacity: 0; transform: scale(4.5); }
        }
        /* impact-spark: sparks of light fly out from the impact centre,
           giving the hit a starburst of debris. --sx / --sy are set per
           element to direct each spark to its own offset. */
        @keyframes impact-spark {
          0%  { opacity: 0; transform: translate(0, 0) scale(1); }
          15% { opacity: 1; transform: translate(calc(var(--sx) * 0.18), calc(var(--sy) * 0.18)) scale(1.3); }
          100% { opacity: 0; transform: translate(var(--sx), var(--sy)) scale(0.4); }
        }
        /* Arrow label pop-in. The label pill ramps in just before the
           trace completes so the story arrives with the force, not after.
           Retained for any legacy callers; the new tethered captions use
           the field-* family below. */
        @keyframes arrow-label-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        /* Field caption family. Three timed pieces — anchor dot, leader
           line, then text — so the eye lands on the action, follows the
           line to the words, then reads. Replaces the boxy pills that
           were pinned to the bottom of the stage. */
        @keyframes field-dot-in {
          from { opacity: 0; transform: scale(0.2); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes field-leader-in {
          from { stroke-dashoffset: 1; opacity: 0; }
          to   { stroke-dashoffset: 0; opacity: 0.7; }
        }
        @keyframes field-caption-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        /* Phase caption holds for the dwell, then quietly fades, so the
           playhead still feels like it has beats without a permanent
           label hanging in the field. Mirrors the old chapter-card cadence. */
        @keyframes phase-dot-cycle {
          0%   { opacity: 0; transform: scale(0.2); }
          10%  { opacity: 1; transform: scale(1); }
          78%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.9); }
        }
        @keyframes phase-leader-cycle {
          0%   { stroke-dashoffset: 1; opacity: 0; }
          10%  { stroke-dashoffset: 0; opacity: 0.75; }
          78%  { stroke-dashoffset: 0; opacity: 0.75; }
          100% { stroke-dashoffset: 0; opacity: 0; }
        }
        @keyframes phase-caption-cycle {
          0%   { opacity: 0; transform: translateY(-6px); }
          10%  { opacity: 1; transform: translateY(0); }
          78%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
        /* Spearhead bloom: a bright disk pops at the arrow's leading edge
           the instant the trace lands. Reads as the moment of contact,
           ahead of the broader impact shockwave. */
        @keyframes spearhead-bloom {
          0%   { opacity: 0; transform: scale(0.3); }
          25%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(2.1); }
        }
        /* Scorch persists for several seconds after impact — a faint
           colored stain at the point of contact. Anchors the eye to
           "this happened here" for the rest of the phase. */
        @keyframes scorch-cycle {
          0%   { opacity: 0; transform: scale(0.4); }
          18%  { opacity: 0.62; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.7); }
        }
        /* Inner white-hot core stain. Sits on top of the colored scorch
           and fades faster, so the very instant after impact reads as
           a flash-burned mark, settling into the colored stain that
           lingers. */
        @keyframes scorch-hot {
          0%   { opacity: 0; transform: scale(0.4); }
          14%  { opacity: 0.75; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.3); }
        }
        /* Path surge: the entire arrow path brightens at the instant of
           impact, then fades. Connects the arrow's energy to the
           destination so the impact reads as the arrival of THIS force
           rather than an unrelated flash at the endpoint. */
        @keyframes arrow-surge {
          0%   { opacity: 0; }
          16%  { opacity: 1; }
          100% { opacity: 0; }
        }
        /* Phase rule: a short horizontal accent line under the phase
           title, in the era accent color. Holds with the title then
           fades together. */
        @keyframes phase-rule-cycle {
          0%   { opacity: 0; transform: scaleX(0.2); }
          12%  { opacity: 0.85; transform: scaleX(1); }
          78%  { opacity: 0.85; transform: scaleX(1); }
          100% { opacity: 0; transform: scaleX(1); }
        }
        .replay-fade-in {
          animation: fade-in 0.6s ease-out;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .chapter-card {
          animation: chapter-flash 3.2s ease-out forwards;
        }
        @keyframes chapter-flash {
          0% { opacity: 0; transform: translateY(-8px) scale(0.98); }
          15% { opacity: 1; transform: translateY(0) scale(1); }
          70% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-4px); }
        }
      `}</style>

      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800/80 bg-[#0a0d18]/90">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
              replay.schematic ? 'text-amber-400/90' : 'text-blue-400/90'
            }`}
            title={
              replay.schematic
                ? 'Auto-generated: positions and phases are illustrative; metadata is from imported sources, not hand-verified.'
                : 'Hand-crafted: narration drawn from standard scholarly accounts. Tactical positions are schematic, not surveyed.'
            }
          >
            {replay.schematic ? 'Schematic replay' : 'Tactical reconstruction'}
          </span>
          <h2 className="text-base font-semibold text-white truncate">{replay.title}</h2>
          {/* Date chip: always visible. Lets the viewer answer "when?" at a
              glance instead of hunting for the year inside the phase
              narration. Pulls from the battle's date_start / year combo via
              the shared formatter. */}
          <span
            className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-slate-800/70 border border-slate-700/60 text-[11px] font-semibold tracking-[0.04em] text-slate-200 whitespace-nowrap"
            title="When this battle was fought"
          >
            {formatBattleDate(battle.date, battle.year) || (battle.year ? String(battle.year) : '')}
          </span>
          {battle.war && (
            <span className="hidden md:inline text-[11px] text-slate-500 truncate max-w-[20ch]" title={battle.war}>
              · {battle.war}
            </span>
          )}
          {replay.battlefieldDesc && (
            <span className="hidden lg:block text-xs text-slate-500 truncate max-w-[34ch]">· {replay.battlefieldDesc}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* One-click jump to the battlefield in Google Earth. Opens in a
              new tab so the replay session is preserved — the user can come
              back to BattleSight from the same tab they left. */}
          <a
            href={`https://earth.google.com/web/@${battle.lat},${battle.lng},0a,8000d,35y,0h,55t,0r`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25 hover:border-emerald-400 transition-colors"
            title="Open this battlefield in Google Earth (new tab)"
          >
            <span className="text-[13px] leading-none">🌍</span>
            <span className="text-xs font-semibold tracking-wide">Earth</span>
          </a>
          <div className="ml-1">
            <CloseButton onClick={onClose} label="Exit replay (Esc)" tone="elevated" />
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex min-h-0">
        {/* Battle stage: globe-based view by default, with the tactical SVG
            available as a fallback toggle. The globe puts the action in real
            geography so the viewer sees Belgium, the Ardennes, the Channel,
            etc. when watching Battle of France, not an abstract grid. */}
        <div className="flex-1 flex items-center justify-center p-2 relative">
          <div className="w-full h-full relative">
            {view === 'surface' ? (
              <TacticalSurface
                battle={battle}
                replay={replay}
                phase={phase}
                phaseIdx={phaseIdx}
                playing={playing}
                speed={speed}
                ended={ended}
                prefersReducedMotion={prefersReducedMotion}
                warCountryColors={(() => {
                  if (warCountryColors) return warCountryColors;
                  if (!battle.war) return undefined;
                  const snap = findSnapshot(battle.war, battle.year || 0);
                  if (!snap) return undefined;
                  return buildCountryColorMap(snap);
                })()}
                warFactionAnchors={warFactionAnchors ?? (() => {
                  if (!battle.war) return undefined;
                  const snap = findSnapshot(battle.war, battle.year || 0);
                  if (!snap) return undefined;
                  return Object.entries(snap.control)
                    .filter(([, list]) => list.length > 0)
                    .map(([faction, list]) => ({ faction, anchor: list[0] }));
                })()}
                warSnapshotYear={warSnapshotYear ?? (() => {
                  if (!battle.war) return undefined;
                  const snap = findSnapshot(battle.war, battle.year || 0);
                  return snap ? Math.floor(snap.year) : undefined;
                })()}
              />
            ) : view === 'globe' ? (
              <GlobeReplay
                battle={battle}
                replay={replay}
                phase={phase}
                phaseIdx={phaseIdx}
                warCountryColors={(() => {
                  // Prefer the live war-cinematic snapshot prop when WarPlayback
                  // is driving the playhead. When the user opens a battle
                  // directly (search, dot-click) there's no parent flow to set
                  // it — in that case auto-resolve from the battle's war + year
                  // so country territory still paints. The Invasion of Poland
                  // 1939 case showed this gap: arrows fired but the map sat
                  // unshaded because warCountryColors was undefined.
                  if (warCountryColors) return warCountryColors;
                  if (!battle.war) return undefined;
                  const snap = findSnapshot(battle.war, battle.year || 0);
                  if (!snap) return undefined;
                  return buildCountryColorMap(snap);
                })()}
                warFactionAnchors={warFactionAnchors ?? (() => {
                  // Auto-resolve faction anchors from the snapshot when
                  // the parent didn't pass them (direct-open path). One
                  // anchor per controlling power, first country in each
                  // control array.
                  if (!battle.war) return undefined;
                  const snap = findSnapshot(battle.war, battle.year || 0);
                  if (!snap) return undefined;
                  return Object.entries(snap.control)
                    .filter(([, list]) => list.length > 0)
                    .map(([faction, list]) => ({ faction, anchor: list[0] }));
                })()}
                warSnapshotYear={warSnapshotYear ?? (() => {
                  if (!battle.war) return undefined;
                  const snap = findSnapshot(battle.war, battle.year || 0);
                  return snap ? Math.floor(snap.year) : undefined;
                })()}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-full max-w-6xl">
                  <div className="rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
                    <TacticalMap key={phaseIdx} phase={phase} aspectRatio={aspectRatio} paletteCtx={replay} />
                  </div>
                </div>
              </div>
            )}

            {/* Phase title appears as a tethered field caption inside the
                globe overlay (see FieldCaption in GlobeReplay), anchored on
                the action centroid in screen coordinates. The old boxy
                bottom-pinned chapter card was removed — it sat far from
                the arrows and covered too much of the stage. */}

            {/* Outro: the battle is over. A composed end card replaces the
                last phase's chapter flash so the replay lands with intention.
                Victor, per-side casualty roll, the battle's significance
                line, and a small action row. The user is no longer watching
                arrows — they are reading the verdict. */}
            {ended && (
              <BattleOutro
                battle={battle}
                replay={replay}
                theme={theme}
                onRestart={restartReplay}
                onBackToStory={onClose}
                cinematicMode={cinematicMode}
                onAdvanceNext={onAdvanceNext}
                onAdvancePrev={onAdvancePrev}
              />
            )}

            {/* View toggle (pinned bottom-left over the stage). */}
            <div className="absolute bottom-3 left-3 flex bg-black/60 border border-white/10 rounded-full overflow-hidden text-[10px] uppercase tracking-wider">
              <button
                onClick={() => setView('surface')}
                className={`px-3 py-1 transition-colors ${
                  view === 'surface' ? 'bg-emerald-500/40 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >Surface</button>
              <button
                onClick={() => setView('globe')}
                className={`px-3 py-1 transition-colors ${
                  view === 'globe' ? 'bg-blue-500/40 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >Globe</button>
              <button
                onClick={() => setView('tactical')}
                className={`px-3 py-1 transition-colors ${
                  view === 'tactical' ? 'bg-blue-500/40 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >Schematic</button>
            </div>
          </div>
        </div>

        {/* Narration sidebar */}
        <aside className="w-[360px] max-w-[40vw] border-l border-slate-800 bg-[#0c101c] flex flex-col">
          <div className="p-6 overflow-y-auto flex-1">
            {/* Sides legend. Always at the top of the sidebar so the user
                can map arrow color to faction at a glance while watching
                the action. The header bar shows the same info but it can
                get cramped on narrow stages. */}
            <div className="mb-4 pb-4 border-b border-slate-800/80 space-y-1.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1.5">Sides</div>
              <SideRow color={factionColorFor('a', replay)} label={replay.factionA} />
              <SideRow color={factionColorFor('b', replay)} label={replay.factionB} />
              {replay.factionC && <SideRow color={factionColorFor('c', replay)} label={replay.factionC} />}
            </div>

            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">
              Phase {phaseIdx + 1} of {replay.phases.length}
              {phase.timeMarker && <span className="text-slate-400"> · {phase.timeMarker}</span>}
            </div>
            <h3 key={`title-${phaseIdx}`} className="replay-fade-in text-xl font-semibold text-white mb-3 tracking-tight">
              {phase.title}
            </h3>
            <NarrationReveal key={`narr-${phaseIdx}`} text={phase.narration} />


            {phaseIdx === 0 && (
              <div className="mt-6 pt-5 border-t border-slate-800/80">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">Setup</div>
                <p className="text-[13px] text-slate-400 leading-relaxed">{replay.intro}</p>
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-slate-800/40 text-[11px] text-slate-500 leading-relaxed">
              {replay.schematic ? (
                <>
                  Auto-generated from this battle's metadata. Force positions are illustrative.
                  The goal is to convey shape, not surveyed coordinates. The metadata itself comes
                  from imported sources and has not been hand-verified.
                </>
              ) : (
                <>
                  Hand-crafted from standard scholarly accounts of the battle. Narration follows
                  primary and secondary sources; tactical positions on this map are schematic and
                  rounded for clarity. See the battle's references in the side panel for sources.
                </>
              )}
            </div>
          </div>

          {/* Chapter rail. Replaces the wrap-row of tiny number pills with a
              horizontally scrolling reel of named chapters. Each chapter
              shows its index, the phase title (truncated), and the time
              marker when available. The active chapter has a flag in the
              era accent so the eye locks onto it without effort. */}
          <div className="border-t border-slate-800 p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 flex items-center justify-between">
              <span>Chapters</span>
              <span className="tabular-nums text-slate-600">{phaseIdx + 1} / {replay.phases.length}</span>
            </div>
            <div
              className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scroll-smooth"
              style={{ scrollbarWidth: 'thin' }}
            >
              {replay.phases.map((p, i) => {
                const isActive = i === phaseIdx;
                const isPast = i < phaseIdx;
                return (
                  <button
                    key={i}
                    onClick={() => goto(i)}
                    className="group relative flex-shrink-0 text-left rounded-md transition-all focus:outline-none focus-visible:ring-2"
                    style={{
                      width: 132,
                      padding: '8px 10px',
                      background: isActive
                        ? `${theme.accent}1f`
                        : isPast
                          ? 'rgba(30,33,46,0.85)'
                          : 'rgba(15,18,28,0.6)',
                      border: isActive
                        ? `1px solid ${theme.accent}66`
                        : '1px solid rgba(51,55,76,0.5)',
                    }}
                    title={p.title}
                  >
                    <div
                      className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] mb-1"
                      style={{
                        color: isActive ? theme.accent : isPast ? '#94a3b8' : '#64748b',
                      }}
                    >
                      <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                      {p.timeMarker && (
                        <>
                          <span className="opacity-50">·</span>
                          <span className="truncate">{p.timeMarker}</span>
                        </>
                      )}
                    </div>
                    <div
                      className="text-[11.5px] leading-snug line-clamp-2"
                      style={{
                        color: isActive ? '#ffffff' : isPast ? '#cbd5e1' : '#94a3b8',
                        fontWeight: isActive ? 600 : 500,
                      }}
                    >
                      {p.title}
                    </div>
                    {/* Active-chapter flag along the bottom edge. */}
                    {isActive && (
                      <span
                        className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full"
                        style={{ background: theme.accent, boxShadow: `0 0 8px ${theme.accent}` }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={onClose}
              className="w-full h-10 rounded-full text-[13px] font-semibold tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
              style={{
                background: phaseIdx === replay.phases.length - 1 ? `${theme.accent}26` : `${theme.accent}14`,
                color: phaseIdx === replay.phases.length - 1 ? '#fff' : '#e2e8f0',
                border: `1px solid ${theme.accent}55`,
              }}
              title="Back to battle story (Esc)"
            >
              {phaseIdx === replay.phases.length - 1 ? 'Done, back to story' : '← Back to story'}
            </button>
          </div>
        </aside>
      </div>

      {/* Transport bar. SVG icons replace the angle-bracket and unicode play
          glyphs the previous version used so the controls read as crafted
          chrome rather than shareware. The active state hugs the era accent
          so the bar coheres with everything else inside the replay. */}
      <footer className="flex items-center gap-3 px-6 py-3 border-t border-slate-800/80 bg-[#0a0d18]/90">
        <button
          onClick={() => goto(phaseIdx - 1)}
          disabled={phaseIdx === 0}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800/80 border border-slate-700/40 text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-25 disabled:hover:bg-slate-800/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
          title="Previous (←)"
          aria-label="Previous chapter"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.5 1.5 L3 5.5 L7.5 9.5" />
          </svg>
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="w-11 h-11 flex items-center justify-center rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d18]"
          style={{
            background: `${theme.accent}33`,
            border: `1px solid ${theme.accent}77`,
            color: '#fff',
            boxShadow: `0 4px 18px -6px ${theme.accent}88`,
          }}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor"><rect x="0.5" y="0.5" width="3.5" height="12" rx="1"/><rect x="8" y="0.5" width="3.5" height="12" rx="1"/></svg>
          ) : (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor"><path d="M1 0.8 L1 12.2 L11 6.5 Z"/></svg>
          )}
        </button>
        <button
          onClick={() => goto(phaseIdx + 1)}
          disabled={phaseIdx >= replay.phases.length - 1}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800/80 border border-slate-700/40 text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-25 disabled:hover:bg-slate-800/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
          title="Next (→)"
          aria-label="Next chapter"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 1.5 L8 5.5 L3.5 9.5" />
          </svg>
        </button>

        <div className="flex-1 px-3">
          <TransportScrubber
            phases={replay.phases}
            phaseIdx={phaseIdx}
            playing={playing}
            speed={speed}
            accent={theme.accent}
            onSeek={goto}
            reducedMotion={prefersReducedMotion}
          />
        </div>

        <div className="flex items-center gap-1.5 bg-slate-800/70 border border-slate-700/40 rounded-full p-0.5">
          {([0.5, 1, 1.5, 2] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className="h-7 px-2.5 text-[10.5px] font-semibold tracking-wide rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
              style={{
                color: s === speed ? '#fff' : '#94a3b8',
                background: s === speed ? `${theme.accent}33` : 'transparent',
              }}
              title={`Playback speed ${s}×`}
              aria-pressed={s === speed}
            >
              {s}×
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

// TransportScrubber is the YouTube-style transport bar for BattleReplay.
// Behaviour mirrors the cinematic-style guide in the user's aboutme.md §5:
// thin baseline track grows on hover, a fill gradient in the era accent
// runs from the start to the playhead, the head is a soft glow dot, scene
// boundaries get tick markers along the track, and a tooltip floats above
// the mouse x (not the playhead) showing the scene about to be jumped to.
// Drag binds to `document` on mousedown so the gesture survives leaving
// the track without dropping the scrub. Within-phase fractional progress
// is interpolated from the wall clock so the fill creeps during playback
// instead of jumping at each phase advance.
interface TransportScrubberProps {
  phases: Replay['phases'];
  phaseIdx: number;
  playing: boolean;
  speed: number;
  accent: string;
  onSeek: (i: number) => void;
  reducedMotion: boolean;
}

function TransportScrubber({ phases, phaseIdx, playing, speed, accent, onSeek, reducedMotion }: TransportScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hovering, setHovering] = useState(false);
  // hover carries both the raw mouse x (tooltip position) and the [0,1]
  // track fraction, captured together at event time so the render never
  // has to measure the track element itself.
  const [hover, setHover] = useState<{ x: number; frac: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // intraProgress is the [0,1] fraction of the current phase that has
  // elapsed during playback, so the fill creeps within a phase instead of
  // sitting at the phase-start mark until the next advance. Resets to 0
  // on phase change. Under reduced motion the fill snaps to the phase
  // boundary (no animated creep).
  const [intraProgress, setIntraProgress] = useState(0);

  // RAF loop for intra-phase progress. Only runs while playing and not
  // dragging; otherwise the fill stays put. The cleanup zeroes the fraction
  // so a pause, scrub, or phase change never leaves stale creep behind.
  useEffect(() => {
    if (!playing || dragging || reducedMotion) return;
    const dur = (phases[phaseIdx]?.durationMs ?? 5500) / Math.max(0.1, speed);
    if (dur <= 0) return;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setIntraProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setIntraProgress(0);
    };
  }, [playing, phaseIdx, speed, phases, dragging, reducedMotion]);

  // Resolve clientX to a phase index using the track's bounding rect.
  const clientXToPhase = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el || phases.length === 0) return 0;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * (phases.length - 1));
  }, [phases.length]);

  // Hover tooltip x → previewed phase index. We do NOT round to the
  // nearest phase for the tooltip position itself; the tooltip follows the
  // raw mouse x so the user sees a continuous slider feel. Only the seek
  // target snaps to a phase.
  const hoverPhase = hover !== null ? Math.round(hover.frac * (phases.length - 1)) : null;

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setDragging(true);
    onSeek(clientXToPhase(e.clientX));
  }, [clientXToPhase, onSeek]);

  // Drag binds to `document` so the gesture survives leaving the track,
  // matching YouTube's behaviour. Without this the user would drop the
  // scrub the moment their mouse exits the bar's vertical band.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => onSeek(clientXToPhase(e.clientX));
    const onUp = () => setDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging, clientXToPhase, onSeek]);

  const onTrackMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHover({ x, frac: Math.max(0, Math.min(1, x / rect.width)) });
  }, []);

  const totalSteps = Math.max(1, phases.length - 1);
  // Fill goes through the end of the current phase plus its intra-phase
  // fraction so the fill creeps live during playback.
  const fillPct = totalSteps === 0
    ? 0
    : ((phaseIdx + (playing && !dragging ? intraProgress : 0)) / totalSteps) * 100;
  const tall = hovering || dragging;

  return (
    <div className="relative w-full select-none" style={{ height: 22, cursor: 'pointer' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); setHover(null); }}
      onMouseMove={onTrackMove}
    >
      {/* Tooltip. Floats above the raw mouse x (not the playhead), shows
          the previewed phase number, title, and time marker if known. */}
      {hoverPhase !== null && hover !== null && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: hover.x,
            bottom: 26,
            transform: 'translateX(-50%)',
            background: 'rgba(8,10,18,0.95)',
            border: `1px solid ${accent}55`,
            borderRadius: 6,
            padding: '6px 9px',
            fontSize: 11,
            color: '#e2e8f0',
            whiteSpace: 'nowrap',
            boxShadow: '0 8px 24px -10px rgba(0,0,0,0.7)',
            zIndex: 5,
            maxWidth: 280,
          }}
        >
          <div style={{ color: accent, fontWeight: 600, letterSpacing: '0.16em', fontSize: 9.5, textTransform: 'uppercase', marginBottom: 2 }}>
            Phase {String(hoverPhase + 1).padStart(2, '0')} {phases[hoverPhase]?.timeMarker ? `· ${phases[hoverPhase].timeMarker}` : ''}
          </div>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260, whiteSpace: 'nowrap' }}>
            {phases[hoverPhase]?.title || 'Phase'}
          </div>
        </div>
      )}

      {/* Track. Hover-grows from 3 → 6px so the bar feels alive without
          dominating the chrome. */}
      <div
        ref={trackRef}
        onMouseDown={onMouseDown}
        className="absolute left-0 right-0"
        style={{
          top: '50%',
          transform: 'translateY(-50%)',
          height: tall ? 6 : 3,
          borderRadius: 999,
          background: 'rgba(30,33,46,0.85)',
          transition: reducedMotion ? 'none' : 'height 140ms ease-out',
          overflow: 'visible',
        }}
      >
        {/* Fill */}
        <div
          className="absolute left-0 top-0 bottom-0 rounded-full pointer-events-none"
          style={{
            width: `${fillPct}%`,
            background: `linear-gradient(90deg, ${accent}cc 0%, ${accent} 100%)`,
            boxShadow: `0 0 6px ${accent}66`,
            transition: dragging || reducedMotion ? 'none' : 'width 80ms linear',
          }}
        />

        {/* Scene boundary ticks. Vertical lines at each phase boundary so
            the user sees the cinematic's structure at a glance. The phase
            currently being played, and ones already played, get a stronger
            tick in the accent colour. */}
        {phases.map((_, i) => {
          if (i === 0 || i === phases.length - 1) return null;
          const left = (i / totalSteps) * 100;
          const past = i <= phaseIdx;
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: `${left}%`,
                width: 1.5,
                background: past ? `${accent}cc` : 'rgba(148,163,184,0.5)',
                transform: 'translateX(-50%)',
                boxShadow: past ? `0 0 4px ${accent}88` : 'none',
              }}
            />
          );
        })}

        {/* Head dot. Sits at the current fill edge; grows + glows on
            hover/drag. */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            left: `${fillPct}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: tall ? 14 : 10,
            height: tall ? 14 : 10,
            background: '#fff',
            border: `2px solid ${accent}`,
            boxShadow: tall ? `0 0 14px ${accent}, 0 0 4px rgba(0,0,0,0.6)` : `0 0 6px ${accent}88`,
            transition: reducedMotion ? 'none' : 'width 140ms ease-out, height 140ms ease-out, box-shadow 140ms ease-out',
          }}
        />
      </div>
    </div>
  );
}

// BattleOutro is the composed end card that replaces the chapter flash on
// the final phase. The replay used to just freeze on the last tactical
// state; now it lands on a curated summary: victor, casualty roll, what it
// meant. The card sits inside the stage area so the underlying globe stays
// visible behind a generous veil; the eye reads "the smoke clears" rather
// than "modal popped up." Two actions: rewatch from phase one, or return to
// the dossier.
interface BattleOutroProps {
  battle: Battle;
  replay: Replay;
  theme: { accent: string; titleFont: string; mood: string };
  onRestart: () => void;
  onBackToStory: () => void;
  // cinematicMode hides the interactive "Replay / Back" action row at the
  // bottom of the outro and replaces it with a quiet "Next battle" cue,
  // because in war cinematic playback the parent timer drives forward
  // motion. The user is not deciding what to do; they're reading the
  // verdict while the campaign rolls on.
  cinematicMode?: boolean;
  // onAdvanceNext / onAdvancePrev surface manual jump buttons next to the
  // "Next battle in a moment" cue so the user can always push past a
  // stuck auto-advance. Each is wired through App so the underlying war
  // cinematic actually moves rather than just dismissing this card.
  onAdvanceNext?: () => void;
  onAdvancePrev?: () => void;
}

function BattleOutro({ battle, replay, theme, onRestart, onBackToStory, cinematicMode = false, onAdvanceNext, onAdvancePrev }: BattleOutroProps) {
  void replay;
  const victor = (battle.victor || '').trim();
  const sides = battle.sides || [];

  // Extract the largest casualty figure from each side's freeform string so
  // the outro can render a real bar chart instead of dumping prose. The
  // comparator gives the eye a single visual signal of the cost on each
  // side instead of a wall of commas.
  const sideStats = sides.slice(0, 4).map((s) => {
    const cleaned = cleanCasualtyText(s.casualties);
    const n = parseLargestNumber(s.casualties);
    return {
      name: s.name,
      commander: s.commander || '',
      strength: s.strength || '',
      casualties: cleaned,
      count: n,
    };
  });
  const maxCount = sideStats.reduce((m, s) => Math.max(m, s.count), 0);
  const isVictorName = (name: string) =>
    !!victor && (name === battle.victor || victor.toLowerCase().includes(name.toLowerCase()));

  // Sort references for the "Further reading" rail. Items with a URL come
  // first so the linkable ones are easy to spot. Caps the rail at six entries
  // so the outro stays readable on small screens.
  const refs = (battle.references || [])
    .slice()
    .sort((a, b) => {
      if (!!a.url !== !!b.url) return a.url ? -1 : 1;
      return (a.title || '').localeCompare(b.title || '');
    })
    .slice(0, 6);

  return (
    <div
      className="pointer-events-auto absolute inset-0 flex items-center justify-center px-6"
      style={{ animation: 'outro-veil-in 600ms ease-out both' }}
    >
      {/* Dual-layer backdrop. First layer is a near-black wash that drops the
          underlying globe to a faint silhouette so the type owns the frame.
          Second is a wide era-accent bloom that pulls the eye to the center
          without flashing color. */}
      <div
        className="absolute inset-0"
        style={{
          background: 'rgba(4,6,12,0.86)',
          backdropFilter: 'blur(10px)',
          animation: 'outro-veil-in 600ms ease-out both',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 45%, ${theme.accent}22 0%, transparent 65%)`,
          animation: 'outro-bloom-in 1400ms ease-out both',
        }}
      />

      <div className="relative w-full max-w-[820px] max-h-[92vh] overflow-y-auto px-1 py-6">
        {/* Top accent: a thin era-colored hairline with a soft glow, like the
            opening of a film frame. */}
        <div
          className="mx-auto mb-6"
          style={{
            width: 86,
            height: 1,
            background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
            boxShadow: `0 0 10px ${theme.accent}aa`,
            animation: 'outro-line-in 700ms 80ms ease-out both',
          }}
        />

        <div
          className="text-center text-[10.5px] font-semibold uppercase tracking-[0.5em] mb-4"
          style={{
            color: theme.accent,
            textShadow: '0 2px 14px rgba(0,0,0,0.7)',
            animation: 'outro-text-rise 700ms 180ms cubic-bezier(.2,.7,.25,1) both',
          }}
        >
          The smoke clears
        </div>

        {/* Hero is the battle name itself, set in the era serif at poster
            scale. The previous version put the victor name in the hero slot
            and pushed the battle name into a small subtitle next to "prevails
            at", which read as "PREVAILS ATBATTLE OF" at narrow widths because
            the tracked small-caps swallowed the separator. The battle name is
            also what the reader came to learn about; the verdict belongs in a
            ribbon below it, not in the title slot. */}
        <h2
          className="text-white leading-[0.96] tracking-tight mx-auto text-center"
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 600,
            fontSize: 'clamp(34px, 4.8vw, 60px)',
            letterSpacing: '-0.015em',
            textShadow: '0 8px 36px rgba(0,0,0,0.85)',
            maxWidth: '22ch',
            animation: 'outro-text-rise 780ms 320ms cubic-bezier(.2,.7,.25,1) both',
          }}
        >
          {battle.name}
        </h2>

        {/* Aliases. Battles that fought under more than one banner (Sharpsburg
            / Antietam, Wacht am Rhein / the Bulge) get an italic alternate-
            name line that reads as a chapter mark from an atlas. */}
        {battle.aliases && battle.aliases.length > 0 && (
          <div
            className="mt-2 text-center text-[12.5px] italic text-slate-400/85"
            style={{
              fontFamily: theme.titleFont,
              animation: 'outro-text-rise 700ms 400ms cubic-bezier(.2,.7,.25,1) both',
            }}
          >
            also known as{' '}
            {battle.aliases.slice(0, 2).map((a, i) => (
              <span key={`${i}-${a.name}`}>
                {i > 0 && <span className="text-slate-600 mx-1.5">·</span>}
                <span className="text-slate-300">{a.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* Date and war strip immediately below the title so the basic
            framing reads without scrolling. Dot separator and a thin
            accent line keep the row light. A regional era line follows
            so an 1815 battle on the Indus reads as "Age of Revolutions
            · Late Mughal" instead of only the global era. */}
        {(() => {
          const dateLine = formatBattleDate(battle.date, battle.year);
          if (!dateLine && !battle.war) return null;
          return (
            <div
              className="mt-3 flex items-center justify-center gap-3 text-[10.5px] tracking-[0.32em] uppercase text-slate-400/85 text-center"
              style={{ animation: 'outro-text-rise 700ms 480ms cubic-bezier(.2,.7,.25,1) both' }}
            >
              {dateLine && <span>{dateLine}</span>}
              {dateLine && battle.war && (
                <span style={{ color: theme.accent }}>·</span>
              )}
              {battle.war && <span className="text-slate-300">{battle.war}</span>}
            </div>
          );
        })()}
        {(() => {
          const local = regionalEraContext(battle.era, battle.lat, battle.lng);
          if (!local) return null;
          return (
            <div
              className="mt-2 text-center text-[10px] tracking-[0.34em] uppercase text-slate-500"
              style={{ animation: 'outro-text-rise 700ms 520ms cubic-bezier(.2,.7,.25,1) both' }}
            >
              {local}
            </div>
          );
        })()}

        {/* Verdict ribbon. A poster-style chip that names the victor clearly
            and is hard to confuse with the rest of the typography. Renders as
            a centered pill with era-accent framing. */}
        {victor ? (
          <div
            className="mt-7 flex items-center justify-center"
            style={{ animation: 'outro-text-rise 780ms 580ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div
              className="inline-flex items-center gap-3 px-5 py-2 rounded-full"
              style={{
                background: `${theme.accent}1a`,
                border: `1px solid ${theme.accent}55`,
                boxShadow: `0 8px 26px -8px ${theme.accent}55`,
              }}
            >
              <span
                className="text-[9.5px] font-semibold uppercase tracking-[0.32em]"
                style={{ color: theme.accent }}
              >
                Victor
              </span>
              <span className="w-px h-3" style={{ background: `${theme.accent}55` }} />
              <span
                className="text-[14px] font-semibold text-white"
                style={{ fontFamily: theme.titleFont }}
              >
                {victor}
              </span>
            </div>
          </div>
        ) : (
          <div
            className="mt-7 flex items-center justify-center"
            style={{ animation: 'outro-text-rise 780ms 580ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div
              className="inline-flex items-center gap-3 px-5 py-2 rounded-full"
              style={{
                background: 'rgba(148,163,184,0.12)',
                border: '1px solid rgba(148,163,184,0.3)',
              }}
            >
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.32em] text-slate-400">
                Outcome
              </span>
              <span className="w-px h-3 bg-slate-500/40" />
              <span className="text-[14px] font-semibold text-slate-200" style={{ fontFamily: theme.titleFont }}>
                Inconclusive
              </span>
            </div>
          </div>
        )}

        {/* Order of battle. A structured ledger of every belligerent in a
            real table — the previous layout used a 1.6/1.5/1/1.2 ratio that
            crushed the strength column and forced "(shore batteries)" or
            "(garrison)" to wrap on every row. The new ratio gives commander
            and strength real breathing room; the casualty column gets a tight
            number plus a bar below, not both inline. The header now lives
            inside the framed card and the columns line up properly. */}
        {sideStats.length > 0 && (
          <div
            className="mx-auto mt-8 w-full max-w-[760px]"
            style={{ animation: 'outro-text-rise 780ms 720ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div
              className="rounded-xl overflow-hidden border"
              style={{
                borderColor: 'rgba(71,80,109,0.55)',
                background: 'rgba(10,12,20,0.55)',
                boxShadow: '0 18px 48px -20px rgba(0,0,0,0.6)',
              }}
            >
              <div
                className="px-5 py-3 border-b flex items-baseline justify-between"
                style={{ borderColor: 'rgba(71,80,109,0.55)' }}
              >
                <div className="text-[10px] uppercase tracking-[0.4em] font-semibold" style={{ color: theme.accent }}>
                  Order&nbsp;of&nbsp;battle
                </div>
                <div className="text-[9.5px] uppercase tracking-[0.22em] text-slate-500 tabular-nums">
                  {sideStats.length} {sideStats.length === 1 ? 'side' : 'sides'}
                </div>
              </div>
              <div
                className="hidden md:grid grid-cols-[1.5fr_1.8fr_1.3fr_1.4fr] gap-4 px-5 py-2.5 text-[9.5px] uppercase tracking-[0.18em] text-slate-500 border-b"
                style={{ borderColor: 'rgba(71,80,109,0.45)' }}
              >
                <div>Side</div>
                <div>Commander</div>
                <div>Strength</div>
                <div>Casualties</div>
              </div>
              {sideStats.map((s, i) => {
                const winner = isVictorName(s.name);
                const pct = maxCount > 0 && s.count > 0
                  ? Math.max(6, Math.min(100, (s.count / maxCount) * 100))
                  : 0;
                return (
                  <div
                    key={`${i}-${s.name}`}
                    className="px-5 py-3.5 border-b last:border-b-0 grid grid-cols-1 md:grid-cols-[1.5fr_1.8fr_1.3fr_1.4fr] gap-x-4 gap-y-1.5 text-[12.5px] text-left"
                    style={{
                      borderColor: 'rgba(71,80,109,0.32)',
                      background: winner ? `${theme.accent}10` : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="font-semibold text-white" title={s.name}>
                        {s.name}
                      </span>
                      {winner && (
                        <span
                          className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                          style={{ background: `${theme.accent}26`, color: theme.accent }}
                        >
                          Victor
                        </span>
                      )}
                    </div>
                    <div className="text-slate-300 leading-snug">
                      <span className="md:hidden text-[9.5px] uppercase tracking-[0.18em] text-slate-500 block mb-0.5">Commander</span>
                      {s.commander || <span className="text-slate-600">Unknown</span>}
                    </div>
                    <div className="text-slate-300 tabular-nums leading-snug">
                      <span className="md:hidden text-[9.5px] uppercase tracking-[0.18em] text-slate-500 block mb-0.5">Strength</span>
                      {s.strength || <span className="text-slate-600">Unknown</span>}
                    </div>
                    <div className="leading-snug">
                      <span className="md:hidden text-[9.5px] uppercase tracking-[0.18em] text-slate-500 block mb-0.5">Casualties</span>
                      <div
                        className="tabular-nums"
                        style={{ color: winner ? theme.accent : '#cbd5e1' }}
                      >
                        {s.count > 0
                          ? formatCompactCasualties(s.count, s.casualties)
                          : (s.casualties || <span className="text-slate-600">Unknown</span>)}
                      </div>
                      {pct > 0 && (
                        <div
                          className="mt-1.5 h-[3px] rounded-full overflow-hidden"
                          style={{ background: 'rgba(148,163,184,0.12)' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: winner
                                ? `linear-gradient(90deg, ${theme.accent}66, ${theme.accent})`
                                : 'linear-gradient(90deg, rgba(148,163,184,0.4), rgba(148,163,184,0.85))',
                              boxShadow: winner ? `0 0 10px ${theme.accent}66` : 'none',
                              animation: `outro-bar-grow 900ms ${860 + i * 90}ms cubic-bezier(.25,.7,.25,1) both`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(() => {
          const sig = cleanProseText(battle.significance);
          if (!sig) return null;
          return (
            <div
              className="mx-auto mt-8 w-full max-w-[760px]"
              style={{ animation: 'outro-text-rise 800ms 1240ms cubic-bezier(.2,.7,.25,1) both' }}
            >
              <div
                className="text-[10px] uppercase tracking-[0.4em] font-semibold mb-2"
                style={{ color: theme.accent }}
              >
                Why&nbsp;it&nbsp;mattered
              </div>
              <p
                className="text-[14.5px] leading-[1.65] text-slate-200/95 text-left"
                style={{
                  fontFamily: theme.titleFont,
                  textShadow: '0 2px 14px rgba(0,0,0,0.55)',
                }}
              >
                {sig}
              </p>
            </div>
          );
        })()}

        {/* Further reading. Curated references with URLs render as inline
            links so the reader can jump straight to a primary or scholarly
            source. References without a URL still show up as a typed entry
            but greyed; this is the most-honest rendering of the data we
            have without inventing search links the user did not ask for. */}
        {refs.length > 0 && (
          <div
            className="mx-auto mt-7 w-full max-w-[760px] text-left"
            style={{ animation: 'outro-text-rise 800ms 1400ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.4em] font-semibold mb-2"
              style={{ color: theme.accent }}
            >
              Further&nbsp;reading
            </div>
            <ul className="space-y-1.5">
              {refs.map((r, i) => {
                const inner = (
                  <span style={{ fontFamily: theme.titleFont }}>
                    {r.title}
                    {r.author ? <span className="text-slate-400 ml-1.5">· {r.author}</span> : null}
                    {r.year ? <span className="text-slate-500 ml-1.5 tabular-nums">({r.year})</span> : null}
                  </span>
                );
                return (
                  <li key={`${i}-${r.title}`} className="text-[12.5px] text-slate-200/90 leading-snug flex items-start gap-2">
                    <span
                      className="mt-[8px] flex-shrink-0 rounded-full"
                      style={{ width: 3, height: 3, background: theme.accent }}
                    />
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline transition-colors"
                        style={{ color: '#e2e8f0' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = theme.accent)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#e2e8f0')}
                      >
                        {inner}
                      </a>
                    ) : (
                      <span className="text-slate-400">{inner}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Outro CTAs. Two clearly distinct affordances, sized to read at
            poster scale rather than as toolbar chips. Primary is the white
            pill the eye lands on; secondary is the era-accent ghost button.
            In war cinematic playback the parent timer drives forward
            motion; we hide the interactive buttons and surface a quiet
            "Next battle" cue with a thin progress sliver, so the campaign
            never feels stuck on a single outro card.
            Wide horizontal padding and a roomy fixed height stop the labels
            from looking cramped, and the serif font matches the rest of the
            outro typography. */}
        {cinematicMode ? (
          <div
            className="mt-10 mb-2 flex flex-col items-center justify-center gap-4"
            style={{ animation: 'outro-text-rise 700ms 1560ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.42em]"
              style={{ color: theme.accent, textShadow: '0 2px 12px rgba(0,0,0,0.65)' }}
            >
              Next battle in a moment
            </div>
            <div
              className="h-[2px] w-[220px] rounded-full overflow-hidden"
              style={{ background: 'rgba(148,163,184,0.18)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: '100%',
                  background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
                  boxShadow: `0 0 14px ${theme.accent}66`,
                  animation: 'outro-cinematic-sweep 4500ms ease-in-out infinite',
                }}
              />
            </div>
            {/* Manual jump controls. The cinematic auto-advance fires after
                its outro pause, but a clear next/prev pair lets the user
                push past it whenever they want, and rescues the campaign
                from any stuck auto-advance. Sits below the sweep so the
                cinematic illusion still feels cinematic when nothing is
                clicked, but agency is one tap away. */}
            <div className="flex items-center gap-3 mt-2">
              {onAdvancePrev && (
                <button
                  type="button"
                  onClick={onAdvancePrev}
                  className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full text-[12px] font-semibold tracking-[0.04em] border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:scale-[1.04] whitespace-nowrap"
                  style={{
                    fontFamily: theme.titleFont,
                    color: '#e2e8f0',
                    borderColor: 'rgba(148,163,184,0.45)',
                    background: 'rgba(15,18,28,0.7)',
                    backdropFilter: 'blur(8px)',
                  }}
                  title="Previous battle"
                  aria-label="Previous battle in the cinematic"
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><path d="M7.5 1.5 L3 5.5 L7.5 9.5 Z"/></svg>
                  Previous
                </button>
              )}
              {onAdvanceNext && (
                <button
                  type="button"
                  onClick={onAdvanceNext}
                  className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full text-[12.5px] font-semibold tracking-[0.04em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:scale-[1.04] whitespace-nowrap"
                  style={{
                    fontFamily: theme.titleFont,
                    color: '#0a0d18',
                    background: theme.accent,
                    boxShadow: `0 10px 24px -10px ${theme.accent}aa, 0 0 0 1px ${theme.accent}55`,
                  }}
                  title="Next battle"
                  aria-label="Next battle in the cinematic"
                >
                  Next battle
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><path d="M3.5 1.5 L8 5.5 L3.5 9.5 Z"/></svg>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            className="mt-12 mb-2 flex items-center justify-center gap-4 flex-wrap"
            style={{ animation: 'outro-text-rise 700ms 1560ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex items-center justify-center gap-2.5 h-12 min-w-[180px] px-7 rounded-full text-[13.5px] font-semibold tracking-[0.04em] border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:scale-[1.02] whitespace-nowrap"
              style={{
                fontFamily: theme.titleFont,
                color: theme.accent,
                borderColor: `${theme.accent}80`,
                background: `${theme.accent}1a`,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 7 A5 5 0 1 1 7 12" />
                <path d="M2 3.5 L2 7 L5.5 7" />
              </svg>
              <span>Replay from start</span>
            </button>
            <button
              type="button"
              onClick={onBackToStory}
              autoFocus
              className="inline-flex items-center justify-center gap-2.5 h-12 min-w-[180px] px-7 rounded-full text-[13.5px] font-semibold tracking-[0.04em] bg-white text-slate-900 hover:bg-slate-100 transition-all shadow-[0_10px_28px_-10px_rgba(255,255,255,0.55)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:scale-[1.02] whitespace-nowrap"
              style={{ fontFamily: theme.titleFont }}
            >
              <span>Back to the story</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 2 L10 7 L5 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes outro-veil-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes outro-bloom-in {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes outro-line-in {
          from { opacity: 0; transform: scaleX(0); }
          to   { opacity: 1; transform: scaleX(1); }
        }
        @keyframes outro-text-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes outro-cinematic-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes outro-bar-grow {
          from { width: 0%; }
        }
      `}</style>
    </div>
  );
}

// parseLargestNumber pulls the biggest comma-separated integer it can find
// out of freeform casualty prose. Caps at 10M to skip page numbers and
// stray reference markers. Returns 0 when nothing parses cleanly.
function parseLargestNumber(s: string | undefined): number {
  if (!s) return 0;
  const matches = s.replace(/,/g, '').match(/\d+/g);
  if (!matches) return 0;
  let best = 0;
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n > best && n <= 10_000_000) best = n;
  }
  return best;
}

// formatCompactCasualties formats a parsed casualty count for the outro
// header. Mirrors thousands-shortening conventions so 117871 renders as
// "117k" rather than dominating the line. Singular handled at the low end so
// "1 casualty" reads correctly instead of "1 casualties".
function formatCompactCasualties(count: number, _raw: string): string {
  void _raw;
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M casualties`;
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1000).toLocaleString()}k casualties`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k casualties`;
  }
  if (count === 1) return '1 casualty';
  return `${count.toLocaleString()} casualties`;
}

// NarrationReveal renders phase narration word-by-word with a soft fade so
// each phrase lands rather than the whole paragraph popping in. The reveal
// budget caps at ~1.3s total regardless of length so a long narration does
// not stall the cadence. Honors prefers-reduced-motion by skipping the
// animation entirely.
function NarrationReveal({ text }: { text: string }) {
  const words = (text || '').split(/(\s+)/);
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const totalWords = words.filter((w) => w.trim().length > 0).length || 1;
  const budgetMs = Math.min(1300, Math.max(360, totalWords * 32));
  const perWordMs = budgetMs / totalWords;

  if (reducedMotion) {
    return (
      <p className="replay-fade-in text-[14px] leading-relaxed text-slate-300">
        {text}
      </p>
    );
  }

  let wordIndex = 0;
  return (
    <p className="text-[14px] leading-relaxed text-slate-300">
      {words.map((tok, i) => {
        if (tok.trim().length === 0) {
          return <span key={i}>{tok}</span>;
        }
        const delay = wordIndex * perWordMs;
        wordIndex++;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: 0,
              transform: 'translateY(3px)',
              animation: `narration-word 360ms ${delay}ms cubic-bezier(.2,.7,.25,1) forwards`,
            }}
          >
            {tok}
          </span>
        );
      })}
      <style>{`
        @keyframes narration-word {
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </p>
  );
}

// SideRow is the prominent color-coded legend used at the top of the
// narration sidebar. Bigger swatch + roomy text so the user can keep their
// eyes on the action and still know which color belongs to whom. The swatch
// uses the same fill color the arrows and unit markers render with, so the
// mapping is one-to-one.
function SideRow({ color, label }: { color: string; label: string }) {
  return (
    <div
      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border"
      style={{ borderColor: `${color}55`, background: `${color}10` }}
    >
      <span
        className="w-3 h-3 rounded-sm flex-shrink-0 shadow-[0_0_6px_currentColor]"
        style={{ backgroundColor: color, color: color }}
      />
      <span className="text-[13px] text-slate-100 font-medium truncate">{label}</span>
    </div>
  );
}
