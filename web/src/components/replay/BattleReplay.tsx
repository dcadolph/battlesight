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
          <button
            onClick={onClose}
            className="ml-1 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-blue-500/50 bg-blue-500/15 text-blue-100 hover:bg-blue-500/30 hover:text-white hover:border-blue-400 transition-colors"
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
  // Victor wins precedence: explicit field on the battle record. Fall back
  // to "Decisive" attribution from the replay title if neither side claims
  // it (most curated replays still name the winner).
  void replay;
  const victor = (battle.victor || '').trim();
  const sides = battle.sides || [];
  return (
    <div
      className="pointer-events-auto absolute inset-0 flex items-center justify-center px-6"
      style={{ animation: 'outro-veil-in 720ms ease-out both' }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, ${theme.accent}10 0%, rgba(7,9,18,0.78) 60%, rgba(7,9,18,0.88) 100%)`,
          backdropFilter: 'blur(6px)',
          animation: 'outro-bg-fade 720ms ease-out both',
        }}
      />
      <div
        className="relative max-w-[640px] w-full text-center"
        style={{ animation: 'outro-block-in 820ms cubic-bezier(.2,.65,.25,1) both' }}
      >
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.42em] mb-3"
          style={{ color: theme.accent, textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}
        >
          The smoke clears
        </div>

        {victor ? (
          <>
            <div
              className="text-white leading-[1.04] tracking-tight"
              style={{
                fontFamily: theme.titleFont,
                fontWeight: 600,
                fontSize: 'clamp(34px, 5.8vw, 64px)',
                letterSpacing: '-0.01em',
                textShadow: '0 6px 32px rgba(0,0,0,0.7)',
              }}
            >
              {victor}
            </div>
            <div className="mt-1 text-[12px] tracking-[0.32em] uppercase text-slate-300/85">
              prevails at {battle.name}
            </div>
          </>
        ) : (
          <div
            className="text-white leading-[1.04] tracking-tight"
            style={{
              fontFamily: theme.titleFont,
              fontWeight: 600,
              fontSize: 'clamp(30px, 4.6vw, 52px)',
              letterSpacing: '-0.01em',
              textShadow: '0 6px 32px rgba(0,0,0,0.7)',
            }}
          >
            {battle.name} ends
          </div>
        )}

        <div
          className="mx-auto mt-5 mb-4 h-px"
          style={{
            width: 140,
            background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
          }}
        />

        {sides.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-[540px] mx-auto mb-5 text-left">
            {sides.slice(0, 4).map((s, i) => {
              const isVictor = victor && s.name === battle.victor;
              return (
                <div
                  key={`${i}-${s.name}`}
                  className="rounded-lg px-3 py-2.5 border"
                  style={{
                    borderColor: isVictor ? `${theme.accent}66` : 'rgba(148,163,184,0.18)',
                    background: isVictor ? `${theme.accent}10` : 'rgba(15,18,28,0.55)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[13px] font-semibold text-white truncate"
                      title={s.name}
                    >
                      {s.name}
                    </span>
                    {isVictor && (
                      <span
                        className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-full"
                        style={{ color: theme.accent, background: `${theme.accent}26` }}
                      >
                        Victor
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {s.casualties ? (
                      <>Casualties · <span className="text-slate-200">{s.casualties}</span></>
                    ) : (
                      <span className="text-slate-500">Casualties unknown</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {battle.significance && (
          <p
            className="text-[14px] leading-[1.6] text-slate-200/90 mx-auto mb-6 max-w-[58ch]"
            style={{
              fontFamily: theme.titleFont,
              fontStyle: 'italic',
              textShadow: '0 2px 12px rgba(0,0,0,0.5)',
            }}
          >
            {battle.significance}
          </p>
        )}

        <div className="flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={onRestart}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full text-[13px] font-semibold tracking-wide border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
            style={{
              color: theme.accent,
              borderColor: `${theme.accent}66`,
              background: `${theme.accent}1a`,
            }}
          >
            ⟲ Replay from start
          </button>
          <button
            type="button"
            onClick={onBackToStory}
            autoFocus
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full text-[13px] font-semibold tracking-wide bg-white text-slate-900 hover:bg-slate-100 transition-colors shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
          >
            Back to the story
          </button>
        </div>
      </div>

      <style>{`
        @keyframes outro-veil-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes outro-bg-fade {
          from { opacity: 0; backdrop-filter: blur(0px); }
          to   { opacity: 1; backdrop-filter: blur(6px); }
        }
        @keyframes outro-block-in {
          from { opacity: 0; transform: translateY(18px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
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
