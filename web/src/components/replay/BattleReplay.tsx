import { useEffect, useRef, useState, useCallback } from 'react';
import type { Battle } from '../../types/battle';
import type { Replay } from '../../types/replay';
import { FACTION_COLOR } from '../../types/replay';
import TacticalMap from './TacticalMap';
import GlobeReplay from './GlobeReplay';
import { themeForEra } from '../../theme/era';
import { playPhaseAdvance, setSoundEra } from '../../audio/sound';
import { usePauseOnHidden } from '../../hooks/usePauseOnHidden';

interface BattleReplayProps {
  battle: Battle;
  initialPhase?: number;
  onClose: () => void;
  onPhaseChange?: (phaseIndex: number) => void;
}

export default function BattleReplay({ battle, initialPhase = 0, onClose, onPhaseChange }: BattleReplayProps) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [phaseIdx, setPhaseIdx] = useState(initialPhase);
  // Auto-play on open. Opening "Watch the battle" implies "play it". Making
  // the user hunt for a play button to see anything happen is a poor default.
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'globe' | 'tactical'>('globe');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/battles/${battle.id}/replay`)
      .then((res) => {
        if (!res.ok) throw new Error('no replay');
        return res.json();
      })
      .then((data: Replay) => {
        setReplay(data);
        setError(null);
      })
      .catch(() => setError('No replay available for this battle.'));
  }, [battle.id]);

  useEffect(() => {
    if (!playing || !replay) return;
    const current = replay.phases[phaseIdx];
    const dur = (current.durationMs ?? 5500) / speed;
    timerRef.current = setTimeout(() => {
      if (phaseIdx >= replay.phases.length - 1) {
        setPlaying(false);
        return;
      }
      setPhaseIdx((i) => i + 1);
    }, dur);
    return () => clearTimeout(timerRef.current);
  }, [playing, phaseIdx, replay, speed]);

  useEffect(() => {
    onPhaseChange?.(phaseIdx);
    // Soft thump on every phase advance. No-op when sound is disabled.
    playPhaseAdvance();
  }, [phaseIdx, onPhaseChange]);

  // Tint the ambient bed to the battle's era while the replay is open.
  useEffect(() => {
    setSoundEra(battle.era || '');
  }, [battle.era]);

  // Pause the phase advance whenever the tab is hidden or the window blurs.
  // Without this the timer keeps firing in the background, the user comes
  // back to find the replay finished, and the audio drone keeps playing
  // even though nothing is on screen.
  usePauseOnHidden(useCallback(() => setPlaying(false), []));

  const goto = useCallback((i: number) => {
    if (!replay) return;
    const clamped = Math.max(0, Math.min(replay.phases.length - 1, i));
    setPhaseIdx(clamped);
  }, [replay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goto(phaseIdx + 1);
      else if (e.key === 'ArrowLeft') goto(phaseIdx - 1);
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goto, phaseIdx]);

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
      {/* Always-visible exit pill, top-right corner. Sits above the header
          so it stays reachable regardless of header content. Esc does the
          same thing, called out in the label so first-time users learn the
          keyboard shortcut without a tour. */}
      <button
        onClick={onClose}
        className="fixed top-3 right-3 z-[60] inline-flex items-center gap-2 h-9 px-4 rounded-full bg-slate-900/90 border border-slate-600/70 text-slate-100 hover:bg-slate-700 hover:border-slate-400 transition-colors shadow-lg"
        title="Close replay (Esc)"
        aria-label="Close replay"
      >
        <span className="text-base leading-none">×</span>
        <span className="text-[12px] font-semibold tracking-wide">Close</span>
        <span className="text-[10px] text-slate-400 font-medium">Esc</span>
      </button>
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
        /* Arrow trace-in: the line draws itself from start to destination.
           pathLength=1 on the path means stroke-dashoffset ranges from 1 to 0
           regardless of geometric length. */
        @keyframes arrow-trace {
          from { stroke-dashoffset: 1; }
          to   { stroke-dashoffset: 0; }
        }
        /* As the marching dashes take over, fade the trace stroke out so we
           don't double-paint the line briefly. */
        @keyframes arrow-trace-fade {
          to { opacity: 0; }
        }
        /* The marching layer carries the arrowhead and fades in only after
           the trace has landed. */
        @keyframes arrow-march-in {
          to { opacity: 1; }
        }
        /* Glow underlay fades in alongside the trace and stays. */
        @keyframes arrow-glow-in {
          to { stroke-opacity: 0.4; }
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
          {replay.battlefieldDesc && (
            <span className="hidden md:block text-xs text-slate-500 truncate max-w-[40ch]">{replay.battlefieldDesc}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <FactionLegend color={FACTION_COLOR.a} label={replay.factionA} />
          <FactionLegend color={FACTION_COLOR.b} label={replay.factionB} />
          {replay.factionC && <FactionLegend color={FACTION_COLOR.c} label={replay.factionC} />}
          <button
            onClick={onClose}
            className="ml-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-blue-500/50 bg-blue-500/15 text-blue-100 hover:bg-blue-500/30 hover:text-white hover:border-blue-400 transition-colors"
            aria-label="Back to battle story (Esc)"
            title="Back to battle story (Esc)"
          >
            <span className="text-base leading-none">←</span>
            <span className="text-xs font-semibold tracking-wide">Back to story</span>
          </button>
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
            {view === 'globe' ? (
              <GlobeReplay
                battle={battle}
                replay={replay}
                phase={phase}
                phaseIdx={phaseIdx}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-full max-w-6xl">
                  <div className="rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
                    <TacticalMap key={phaseIdx} phase={phase} aspectRatio={aspectRatio} />
                  </div>
                </div>
              </div>
            )}

            {/* Chapter card: flashes the phase title centered over the map at
                the start of each phase, then fades. Keyed on phaseIdx so it
                replays on every advance. */}
            <div
              key={`chapter-${phaseIdx}`}
              className="chapter-card pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div
                className="px-7 py-4 rounded-xl bg-black/55 backdrop-blur-sm border shadow-2xl text-center"
                style={{ borderColor: `${theme.accent}40` }}
              >
                {phase.timeMarker && (
                  <div
                    className="text-[10px] uppercase tracking-[0.32em] mb-1"
                    style={{ color: theme.accent }}
                  >
                    {phase.timeMarker}
                  </div>
                )}
                <div
                  className="text-3xl text-white tracking-tight"
                  style={{ fontFamily: theme.titleFont, fontWeight: 600 }}
                >
                  {phase.title}
                </div>
              </div>
            </div>

            {/* View toggle (pinned bottom-left over the stage). */}
            <div className="absolute bottom-3 left-3 flex bg-black/60 border border-white/10 rounded-full overflow-hidden text-[10px] uppercase tracking-wider">
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
              >Tactical</button>
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
              <SideRow color={FACTION_COLOR.a} label={replay.factionA} />
              <SideRow color={FACTION_COLOR.b} label={replay.factionB} />
              {replay.factionC && <SideRow color={FACTION_COLOR.c} label={replay.factionC} />}
            </div>

            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">
              Phase {phaseIdx + 1} of {replay.phases.length}
              {phase.timeMarker && <span className="text-slate-400"> · {phase.timeMarker}</span>}
            </div>
            <h3 key={`title-${phaseIdx}`} className="replay-fade-in text-xl font-semibold text-white mb-3 tracking-tight">
              {phase.title}
            </h3>
            <p key={`narr-${phaseIdx}`} className="replay-fade-in text-[14px] leading-relaxed text-slate-300">
              {phase.narration}
            </p>

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

          {/* Phase pill nav */}
          <div className="border-t border-slate-800 p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {replay.phases.map((p, i) => (
                <button
                  key={i}
                  onClick={() => goto(i)}
                  className={`h-6 px-2 rounded text-[10px] transition-colors ${
                    i === phaseIdx
                      ? 'bg-blue-500/25 text-blue-300 border border-blue-500/40'
                      : i < phaseIdx
                      ? 'bg-slate-800 text-slate-400 border border-slate-700/60 hover:text-white'
                      : 'bg-slate-900 text-slate-600 border border-slate-800 hover:text-slate-300'
                  }`}
                  title={p.title}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className={`w-full h-9 rounded-md border text-[12px] font-semibold tracking-wide transition-colors ${
                phaseIdx === replay.phases.length - 1
                  ? 'border-blue-500/60 bg-blue-500/25 text-blue-100 hover:bg-blue-500/40'
                  : 'border-blue-500/40 bg-blue-500/10 text-blue-200 hover:bg-blue-500/25 hover:text-white'
              }`}
              title="Back to battle story (Esc)"
            >
              {phaseIdx === replay.phases.length - 1 ? 'Done, back to story' : '← Back to story'}
            </button>
          </div>
        </aside>
      </div>

      {/* Bottom controls */}
      <footer className="flex items-center gap-4 px-6 py-3 border-t border-slate-800/80 bg-[#0a0d18]/90">
        <button
          onClick={() => goto(phaseIdx - 1)}
          disabled={phaseIdx === 0}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-25"
          title="Previous (←)"
        >
          ‹
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-blue-500/25 text-blue-300 hover:bg-blue-500/40 transition-colors"
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => goto(phaseIdx + 1)}
          disabled={phaseIdx >= replay.phases.length - 1}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-25"
          title="Next (→)"
        >
          ›
        </button>

        <div className="flex-1 px-3">
          <input
            type="range"
            min={0}
            max={replay.phases.length - 1}
            value={phaseIdx}
            onChange={(e) => goto(parseInt(e.target.value))}
            className="w-full accent-blue-500 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer"
          />
        </div>

        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="bg-slate-800 border border-slate-700/60 rounded text-xs text-slate-300 px-2 py-1 focus:outline-none"
          title="Playback speed"
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={1.5}>1.5×</option>
          <option value={2}>2×</option>
        </select>
      </footer>
    </div>
  );
}

function FactionLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] text-slate-300 bg-slate-800/70 border border-slate-700/40">
      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
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
