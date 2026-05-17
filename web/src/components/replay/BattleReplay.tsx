import { useEffect, useRef, useState, useCallback } from 'react';
import type { Battle } from '../../types/battle';
import type { Replay } from '../../types/replay';
import { factionColorFor } from '../../types/replay';
import TacticalMap from './TacticalMap';
import GlobeReplay from './GlobeReplay';
import { themeForEra } from '../../theme/era';
import { playPhaseAdvance, setSoundEra } from '../../audio/sound';
import { usePauseOnHidden } from '../../hooks/usePauseOnHidden';
import CloseButton from '../CloseButton';

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
  // ended is true after the last phase's dwell completes. It triggers the
  // outro card so the replay lands with intention instead of just freezing
  // on the final tactical state. Cleared whenever the user scrubs back.
  const [ended, setEnded] = useState(false);
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
        /* Arrow label pop-in. The label pill ramps in just before the
           trace completes so the story arrives with the force, not after. */
        @keyframes arrow-label-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
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
          {/* One-click jump to the battlefield in Google Earth. Opens in a
              new tab so the replay session is preserved — the user can come
              back to BattleTrace from the same tab they left. */}
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
                    <TacticalMap key={phaseIdx} phase={phase} aspectRatio={aspectRatio} aggressor={replay.aggressor} />
                  </div>
                </div>
              </div>
            )}

            {/* Chapter card: flashes the phase title centered over the map at
                the start of each phase, then fades. Keyed on phaseIdx so it
                replays on every advance. Suppressed when the outro card is
                up so the two do not overlap on the final phase. */}
            {!ended && (
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
            )}

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
              />
            )}

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
              <SideRow color={factionColorFor('a', replay.aggressor)} label={replay.factionA} />
              <SideRow color={factionColorFor('b', replay.aggressor)} label={replay.factionB} />
              {replay.factionC && <SideRow color={factionColorFor('c', replay.aggressor)} label={replay.factionC} />}
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
          <input
            type="range"
            min={0}
            max={replay.phases.length - 1}
            value={phaseIdx}
            onChange={(e) => goto(parseInt(e.target.value))}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, ${theme.accent} 0%, ${theme.accent} ${(phaseIdx / Math.max(1, replay.phases.length - 1)) * 100}%, rgba(30,33,46,0.85) ${(phaseIdx / Math.max(1, replay.phases.length - 1)) * 100}%, rgba(30,33,46,0.85) 100%)`,
              accentColor: theme.accent,
            }}
            aria-label="Phase position"
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
}

function BattleOutro({ battle, replay, theme, onRestart, onBackToStory }: BattleOutroProps) {
  void replay;
  const victor = (battle.victor || '').trim();
  const sides = battle.sides || [];

  // Extract the largest casualty figure from each side's freeform string so
  // the outro can render a real bar chart instead of dumping prose. The
  // comparator gives the eye a single visual signal of the cost on each
  // side instead of a wall of commas.
  const sideStats = sides.slice(0, 4).map((s) => {
    const n = parseLargestNumber(s.casualties);
    return { name: s.name, casualties: s.casualties, count: n };
  });
  const maxCount = sideStats.reduce((m, s) => Math.max(m, s.count), 0);
  const isVictorName = (name: string) =>
    !!victor && (name === battle.victor || victor.toLowerCase().includes(name.toLowerCase()));

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

      <div className="relative w-full max-w-[760px]">
        {/* Top accent: a thin era-colored hairline with a soft glow, like the
            opening of a film frame. */}
        <div
          className="mx-auto mb-7"
          style={{
            width: 86,
            height: 1,
            background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
            boxShadow: `0 0 10px ${theme.accent}aa`,
            animation: 'outro-line-in 700ms 80ms ease-out both',
          }}
        />

        <div
          className="text-center text-[10.5px] font-semibold uppercase tracking-[0.5em] mb-5"
          style={{
            color: theme.accent,
            textShadow: '0 2px 14px rgba(0,0,0,0.7)',
            animation: 'outro-text-rise 700ms 180ms cubic-bezier(.2,.7,.25,1) both',
          }}
        >
          The smoke clears
        </div>

        {victor ? (
          <div
            className="text-center"
            style={{ animation: 'outro-text-rise 780ms 320ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <h2
              className="text-white leading-[0.98] tracking-tight mx-auto"
              style={{
                fontFamily: theme.titleFont,
                fontWeight: 600,
                fontSize: 'clamp(36px, 5.2vw, 72px)',
                letterSpacing: '-0.015em',
                textShadow: '0 8px 36px rgba(0,0,0,0.8)',
                maxWidth: '22ch',
              }}
            >
              {victor}
            </h2>
            <div className="mt-3 text-[11px] tracking-[0.42em] uppercase text-slate-400/90">
              <span style={{ color: theme.accent }}>prevails at</span>
              <span className="text-slate-300 ml-2">{battle.name}</span>
            </div>
          </div>
        ) : (
          <div
            className="text-center"
            style={{ animation: 'outro-text-rise 780ms 320ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <h2
              className="text-white leading-[0.98] tracking-tight mx-auto"
              style={{
                fontFamily: theme.titleFont,
                fontWeight: 600,
                fontSize: 'clamp(30px, 4.4vw, 60px)',
                letterSpacing: '-0.015em',
                textShadow: '0 8px 36px rgba(0,0,0,0.8)',
                maxWidth: '22ch',
              }}
            >
              {battle.name} ends
            </h2>
          </div>
        )}

        {/* Casualty roll. When at least one side has a parseable count we
            render proportional bars so the cost reads as a comparison at a
            glance. Otherwise fall back to a clean two-up label/quote layout. */}
        {sideStats.length > 0 && (
          <div
            className="mx-auto mt-8 max-w-[540px]"
            style={{ animation: 'outro-text-rise 780ms 560ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div className="text-[10px] uppercase tracking-[0.42em] text-slate-500 mb-3 text-center">
              Casualty&nbsp;roll
            </div>
            <div className="space-y-2.5">
              {sideStats.map((s, i) => {
                const winner = isVictorName(s.name);
                const pct = maxCount > 0 && s.count > 0
                  ? Math.max(6, Math.min(100, (s.count / maxCount) * 100))
                  : 0;
                return (
                  <div key={`${i}-${s.name}`} className="text-left">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span
                        className="text-[13px] font-semibold text-white truncate"
                        style={{ maxWidth: '60%' }}
                        title={s.name}
                      >
                        {s.name}
                      </span>
                      <span
                        className="text-[12px] tabular-nums"
                        style={{ color: winner ? theme.accent : '#cbd5e1' }}
                      >
                        {s.count > 0 ? formatCompactCasualties(s.count, s.casualties) : (s.casualties || 'Casualties unknown')}
                      </span>
                    </div>
                    {pct > 0 && (
                      <div
                        className="h-[3px] rounded-full overflow-hidden"
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
                            animation: `outro-bar-grow 900ms ${720 + i * 90}ms cubic-bezier(.25,.7,.25,1) both`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {battle.significance && (
          <p
            className="text-[14.5px] leading-[1.65] text-slate-200/90 mx-auto mt-8 max-w-[58ch] text-center"
            style={{
              fontFamily: theme.titleFont,
              fontStyle: 'italic',
              textShadow: '0 2px 14px rgba(0,0,0,0.55)',
              animation: 'outro-text-rise 800ms 1100ms cubic-bezier(.2,.7,.25,1) both',
            }}
          >
            {battle.significance}
          </p>
        )}

        <div
          className="mt-9 flex items-center justify-center gap-3"
          style={{ animation: 'outro-text-rise 700ms 1380ms cubic-bezier(.2,.7,.25,1) both' }}
        >
          <button
            type="button"
            onClick={onRestart}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-full text-[13px] font-semibold tracking-wide border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:scale-[1.02]"
            style={{
              color: theme.accent,
              borderColor: `${theme.accent}66`,
              background: `${theme.accent}14`,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 6 A4.5 4.5 0 1 1 6 10.5" />
              <path d="M1.5 3 L1.5 6 L4.5 6" />
            </svg>
            Replay from start
          </button>
          <button
            type="button"
            onClick={onBackToStory}
            autoFocus
            className="inline-flex items-center gap-2 h-11 px-6 rounded-full text-[13px] font-semibold tracking-wide bg-white text-slate-900 hover:bg-slate-100 transition-all shadow-[0_8px_24px_-8px_rgba(255,255,255,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:scale-[1.02]"
          >
            Back to the story
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 1.5 L8.5 6 L4 10.5" />
            </svg>
          </button>
        </div>
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
// "117k" rather than dominating the line. Includes the original prose in
// the title attribute via the calling site if needed.
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
