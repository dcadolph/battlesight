import { useEffect, useRef, useState, useCallback } from 'react';
import type { Battle } from '../../types/battle';
import type { Replay } from '../../types/replay';
import { FACTION_COLOR } from '../../types/replay';
import TacticalMap from './TacticalMap';

interface BattleReplayProps {
  battle: Battle;
  initialPhase?: number;
  onClose: () => void;
  onPhaseChange?: (phaseIndex: number) => void;
}

export default function BattleReplay({ battle, initialPhase = 0, onClose, onPhaseChange }: BattleReplayProps) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [phaseIdx, setPhaseIdx] = useState(initialPhase);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
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
  }, [phaseIdx, onPhaseChange]);

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

  return (
    <div className="fixed inset-0 bg-[#070912] z-50 flex flex-col">
      <style>{`
        @keyframes dash-in {
          to { stroke-dashoffset: 0; }
        }
        .replay-fade-in {
          animation: fade-in 0.6s ease-out;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
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
            <span className="hidden md:block text-xs text-slate-500 truncate max-w-[40ch]">— {replay.battlefieldDesc}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <FactionLegend color={FACTION_COLOR.a} label={replay.factionA} />
          <FactionLegend color={FACTION_COLOR.b} label={replay.factionB} />
          {replay.factionC && <FactionLegend color={FACTION_COLOR.c} label={replay.factionC} />}
          <button
            onClick={onClose}
            className="ml-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 hover:text-white hover:border-slate-500 transition-colors"
            aria-label="Close replay (Esc)"
            title="Close (Esc)"
          >
            <span className="text-xs font-medium tracking-wide">Back to globe</span>
            <span className="text-base leading-none">✕</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex min-h-0">
        {/* Tactical map */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-6xl">
            <div className="rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
              <TacticalMap key={phaseIdx} phase={phase} aspectRatio={aspectRatio} />
            </div>
          </div>
        </div>

        {/* Narration sidebar */}
        <aside className="w-[360px] max-w-[40vw] border-l border-slate-800 bg-[#0c101c] flex flex-col">
          <div className="p-6 overflow-y-auto flex-1">
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
                  Auto-generated from this battle's metadata. Force positions are illustrative —
                  the goal is to convey shape, not surveyed coordinates. The metadata itself comes
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
              className={`w-full h-9 rounded-md border text-[12px] font-medium tracking-wide transition-colors ${
                phaseIdx === replay.phases.length - 1
                  ? 'border-blue-500/50 bg-blue-500/20 text-blue-200 hover:bg-blue-500/30'
                  : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="Esc"
            >
              {phaseIdx === replay.phases.length - 1 ? 'Done — back to globe' : 'Exit replay'}
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
